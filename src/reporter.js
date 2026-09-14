/**
 * @file The core reporter. `createRevuServer()` wires the pre-filter, the
 * bounded queue and the transport together behind three methods that never
 * throw: `track()`, `flush()` and `shutdown()`.
 *
 * Delivery rules, all in this file:
 *
 * - `track()` is synchronous and never touches the network. Sending happens
 *   on the flush timer, on a deferred early flush when `flushAt` hits are
 *   queued, or when an adapter hands `flush()` to the runtime's `waitUntil`.
 * - One request in flight at a time. Concurrent `flush()` calls share it.
 * - A network error, timeout, 408 or 5xx gets exactly one retry after
 *   `retryDelayMs`. If that fails too, the batch is dropped and sending
 *   pauses (`backoffMs`, doubling to `maxBackoffMs`).
 * - 429 keeps the batch and pauses for `Retry-After` (or the backoff).
 * - 413 drops the batch, halves the batch size and pauses.
 * - 401 / 403 stops sending until the process restarts.
 * - The `beforeExit` flush makes a single attempt with no retry, so a natural
 *   exit waits at most `timeoutMs` for an unresponsive endpoint.
 */

import { resolveConfig } from "./config.js";
import { toCrawlEvent } from "./event.js";
import { BoundedQueue } from "./queue.js";
import { sendBatch } from "./transport.js";
import { createLogger, safe, safeAsync, sleep, unrefTimer, withDeadline } from "./utils.js";

/**
 * Flush callbacks of live reporters, run on the process `beforeExit` event.
 * A single shared listener avoids one listener per reporter.
 * @type {Set<() => Promise<void>>}
 */
const exitFlushes = new Set();
let exitHookInstalled = false;

/**
 * Install the shared `beforeExit` listener once, where the runtime has one
 * (Node, Bun). `beforeExit` fires only on a natural exit, never on signals,
 * so it does not change how the host handles `SIGTERM` or `SIGINT`.
 * @returns {void}
 */
function installExitHook() {
  if (exitHookInstalled) return;
  const proc = /** @type {any} */ (globalThis).process;
  if (!proc || typeof proc.on !== "function") return;
  exitHookInstalled = true;
  try {
    proc.on("beforeExit", () => {
      for (const flush of exitFlushes) flush();
    });
  } catch {}
}

/** @returns {import("./types.js").RevuServer} A reporter that does nothing. */
function createDisabledReporter() {
  return {
    track: () => false,
    flush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

/**
 * REVU's per-hit counts from a `202` body, as a debug suffix such as
 * `: 2 accepted, 0 duplicate(s), 1 rejected (unknown_host 1)`. A rejected
 * `unknown_host` means the touchpoint's domains do not cover the host. Empty
 * when the body did not carry the counts.
 *
 * @param {unknown} result
 * @returns {string}
 */
function describeResult(result) {
  if (!result || typeof result !== "object") return "";
  const r = /** @type {Record<string, unknown>} */ (result);
  if (typeof r.accepted !== "number") return "";
  const reasons =
    r.rejected && typeof r.rejected === "object"
      ? Object.entries(r.rejected).filter(([, n]) => typeof n === "number" && n > 0)
      : [];
  const total = reasons.reduce((sum, [, n]) => sum + Number(n), 0);
  const detail = reasons.length ? ` (${reasons.map(([k, n]) => `${k} ${n}`).join(", ")})` : "";
  return `: ${r.accepted} accepted, ${Number(r.duplicates) || 0} duplicate(s), ${total} rejected${detail}`;
}

/**
 * Create a reporter.
 *
 * Never throws. With a missing or invalid `serverKey` it returns a disabled
 * reporter whose methods are no-ops (the reason is logged when `debug` is on),
 * so a misconfigured deploy keeps serving traffic normally.
 *
 * @example
 * import { createRevuServer } from "@revu-ai/server";
 *
 * const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
 *
 * @param {import("./types.js").RevuServerOptions} options
 * @returns {import("./types.js").RevuServer}
 */
export function createRevuServer(options) {
  const log = createLogger(Boolean(options && options.debug === true));
  try {
    const resolved = resolveConfig(options);
    if (!resolved.config) {
      log.once("config", resolved.problem);
      return createDisabledReporter();
    }
    if (resolved.config.trustProxy === true && !resolved.config.ipHeader) {
      log.once(
        "trust-proxy-true",
        "trustProxy: true takes the leftmost X-Forwarded-For entry, which any client can set. Prefer a hop count (trustProxy: 1) or ipHeader.",
      );
    }
    return createReporter(resolved.config, log);
  } catch (err) {
    log.debug("createRevuServer failed. Reporting is disabled.", err);
    return createDisabledReporter();
  }
}

/**
 * Build the live reporter for a validated config.
 * @param {import("./config.js").ResolvedConfig} config
 * @param {import("./utils.js").Logger} log
 * @returns {import("./types.js").RevuServer}
 */
function createReporter(config, log) {
  /** @type {BoundedQueue<import("./types.js").CrawlEvent>} */
  const queue = new BoundedQueue(config.maxQueueSize);
  /** @param {unknown} err */
  const onError = (err) => log.debug("internal error (ignored):", err);

  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  /** @type {Promise<void> | null} */
  let inflight = null;
  let flushScheduled = false;
  let unauthorized = false;
  let stopped = false;
  /** True while the exit flush runs: no retry, so exit is never held up. */
  let exiting = false;
  let pausedUntil = 0;
  let failures = 0;
  let batchSize = config.maxBatchSize;
  /** When the last send started, for `minSendIntervalMs`. */
  let lastSendAt = 0;

  /**
   * Pause sending. Uses `retryAfterMs` when the server named a delay,
   * otherwise exponential backoff. Both are capped at `maxBackoffMs`.
   * @param {number} [retryAfterMs]
   */
  function pause(retryAfterMs) {
    const backoff = config.backoffMs * 2 ** failures;
    failures += 1;
    const ms = Math.min(retryAfterMs ?? backoff, config.maxBackoffMs);
    pausedUntil = Date.now() + ms;
    log.debug(`sending paused for ${ms} ms`);
  }

  /** Drop a batch and note it in debug. */
  const drop = (/** @type {number} */ count, /** @type {string} */ why) =>
    log.debug(`dropped ${count} hit(s): ${why}`);

  /**
   * Send one batch with at most one retry, then act on the outcome.
   * @param {import("./types.js").CrawlEvent[]} batch
   * @returns {Promise<boolean>} Whether draining may continue. Any failure,
   *   throttle or rejected key ends the current drain, so a server answering
   *   429 with `Retry-After: 0` can never cause a tight resend loop.
   */
  async function deliver(batch) {
    const send = () =>
      sendBatch({
        fetch: config.fetch,
        url: config.url,
        serverKey: config.serverKey,
        events: batch,
        timeoutMs: config.timeoutMs,
        readResult: config.debug,
      });

    let outcome = await send();
    if (outcome.kind === "retryable" && !exiting) {
      await sleep(config.retryDelayMs);
      outcome = await send();
    }

    switch (outcome.kind) {
      case "ok":
        failures = 0;
        log.debug(`sent ${batch.length} hit(s)${describeResult(outcome.result)}`);
        return true;
      case "unauthorized":
        unauthorized = true;
        queue.clear();
        stopTimer();
        log.once(
          "unauthorized",
          `REVU rejected the server key (HTTP ${outcome.status}). Reporting is off until restart.`,
        );
        return false;
      case "throttled": {
        const lost = queue.unshift(batch);
        if (lost) drop(lost, "queue full while throttled");
        pause(outcome.retryAfterMs);
        return false;
      }
      case "too_large":
        batchSize = Math.max(1, Math.floor(batch.length / 2));
        drop(batch.length, `payload too large, batch size is now ${batchSize}`);
        pause();
        return false;
      case "retryable":
        drop(batch.length, `send failed twice${outcome.status ? ` (HTTP ${outcome.status})` : ""}`);
        pause();
        return false;
      default:
        drop(batch.length, `rejected (HTTP ${outcome.status})`);
        return true;
    }
  }

  /**
   * Send queued hits batch by batch until the queue is empty, sending is
   * paused, or the key was rejected.
   *
   * Sends are spaced at least `minSendIntervalMs` apart. Edge adapters flush
   * after every reported hit, so without the spacing a burst would cost one
   * request per hit. The wait runs inside the shared drain, so hits tracked
   * meanwhile join the next batch, and a runtime's `waitUntil` keeps the
   * isolate alive for it. The exit flush and `shutdown()` never wait.
   * @returns {Promise<void>}
   */
  async function drain() {
    while (queue.size > 0 && !unauthorized && Date.now() >= pausedUntil) {
      const wait = lastSendAt + config.minSendIntervalMs - Date.now();
      if (wait > 0 && !exiting && !stopped) await sleep(wait);
      lastSendAt = Date.now();
      if (!(await deliver(queue.take(batchSize)))) return;
    }
  }

  /** @returns {Promise<void>} The shared in-flight drain. */
  function flushNow() {
    if (!inflight) {
      inflight = drain()
        .catch(onError)
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /** Start the periodic flush lazily, on the first queued hit. */
  function ensureTimer() {
    if (timer || config.flushIntervalMs <= 0) return;
    timer = setInterval(() => {
      if (queue.size > 0) flushNow();
    }, config.flushIntervalMs);
    unrefTimer(timer);
  }

  /**
   * Early flush once `flushAt` hits are queued, deferred to a later tick so
   * serializing and sending never run inside the request that tipped it over.
   */
  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    const t = setTimeout(() => {
      flushScheduled = false;
      flushNow();
    }, 0);
    unrefTimer(t);
  }

  /** Flush on natural exit: one attempt per batch, no retry sleep. */
  const exitFlush = () => {
    exiting = true;
    return flushNow().finally(() => {
      exiting = false;
    });
  };

  /** @type {import("./types.js").RevuServer["track"]} */
  const track = (request) => {
    if (stopped || unauthorized || !request || typeof request !== "object") return false;
    const event = toCrawlEvent(request, config);
    if (!event) return false;
    if (queue.push(event)) log.once("queue-full", "queue full, dropping the oldest hits.");
    ensureTimer();
    if (config.flushOnExit && !exitFlushes.has(exitFlush)) {
      installExitHook();
      exitFlushes.add(exitFlush);
    }
    if (queue.size >= config.flushAt) scheduleFlush();
    return true;
  };

  const safeTrack = safe(track, onError);

  return {
    track: (request) => safeTrack(request) === true,
    flush: safeAsync(async () => flushNow(), onError),
    shutdown: safeAsync(async () => {
      if (stopped) return;
      stopped = true;
      stopTimer();
      exitFlushes.delete(exitFlush);
      await withDeadline(flushNow(), config.shutdownTimeoutMs);
    }, onError),
  };
}
