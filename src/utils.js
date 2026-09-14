/**
 * @file Small, dependency-free helpers shared across the SDK (DRY). Everything
 * here is portable across Node 20+, Bun, Deno and edge runtimes: no `node:*`
 * imports, and runtime-specific globals are reached through `globalThis`.
 */

/** Prefix on every debug log line so SDK output is easy to grep. */
const LOG_PREFIX = "[revu/server]";

/**
 * Wrap a function so it can NEVER throw into the host server. This is the
 * cardinal invariant of the SDK: a reporting library that breaks the
 * customer's request handling is worse than no library at all. Errors are
 * swallowed and handed to `onError` (which logs them in debug mode).
 * @template {(...args: any[]) => any} F
 * @param {F} fn
 * @param {(err: unknown) => void} [onError]
 * @returns {(...args: Parameters<F>) => ReturnType<F> | undefined}
 */
export function safe(fn, onError) {
  return function safeWrapped(...args) {
    try {
      return fn(...args);
    } catch (err) {
      if (onError) onError(err);
      return undefined;
    }
  };
}

/**
 * Async counterpart of {@link safe}: the returned promise always resolves and
 * never rejects, whether `fn` throws synchronously or its promise rejects.
 * @template {(...args: any[]) => Promise<any>} F
 * @param {F} fn
 * @param {(err: unknown) => void} [onError]
 * @returns {(...args: Parameters<F>) => Promise<Awaited<ReturnType<F>> | undefined>}
 */
export function safeAsync(fn, onError) {
  return async function safeAsyncWrapped(...args) {
    try {
      return await fn(...args);
    } catch (err) {
      if (onError) onError(err);
      return undefined;
    }
  };
}

/**
 * @typedef {object} Logger
 * @property {(...args: unknown[]) => void} debug Log a line when debug mode is on.
 * @property {(key: string, ...args: unknown[]) => void} once
 *   Log a line at most once per `key` for the lifetime of the logger, so a
 *   persistent condition (a bad key, a dropped queue) does not flood the log.
 */

/**
 * Create the debug logger. Silent unless `enabled`. Never throws, even when
 * `console` is unavailable or patched by the host.
 * @param {boolean} enabled
 * @returns {Logger}
 */
export function createLogger(enabled) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {unknown[]} args */
  const write = (args) => {
    try {
      console.warn(LOG_PREFIX, ...args);
    } catch {}
  };
  return {
    debug(...args) {
      if (enabled) write(args);
    },
    once(key, ...args) {
      if (!enabled || seen.has(key)) return;
      seen.add(key);
      write(args);
    },
  };
}

/**
 * Anything that carries request headers: a WHATWG `Headers` object (fetch
 * runtimes) or a plain object with lowercase keys (Node `IncomingMessage`).
 * @typedef {{ get(name: string): string | null } | Record<string, string | string[] | number | undefined>} HeadersLike
 */

/**
 * Read one header from a {@link HeadersLike}, case-insensitively for `Headers`
 * and by lowercase key for plain objects. Repeated Node headers delivered as
 * arrays are joined with `", "`, matching how `Headers#get` combines them.
 * @param {HeadersLike | null | undefined} headers
 * @param {string} name Header name. Pass it lowercase.
 * @returns {string | undefined}
 */
export function getHeader(headers, name) {
  if (!headers) return undefined;
  try {
    const h = /** @type {any} */ (headers);
    if (typeof h.get === "function") {
      const value = h.get(name);
      return value == null ? undefined : String(value);
    }
    const value = h[name];
    if (value == null) return undefined;
    return Array.isArray(value) ? value.join(", ") : String(value);
  } catch {
    return undefined;
  }
}

/**
 * RFC 4122 version 4 UUID. Uses `crypto.randomUUID`, which every supported
 * runtime provides (Node 20+, Bun, Deno, edge runtimes). Falls back to
 * `crypto.getRandomValues`, then `Math.random`, for unusual hosts. Event ids
 * only need uniqueness for server-side dedup, not unpredictability, so the
 * last fallback is acceptable.
 * @returns {string}
 */
export function uuid() {
  const c = /** @type {any} */ (globalThis).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0;
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Truncate a string to `max` characters (bounds payload size).
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
export function truncate(value, max) {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Let a timer stop keeping the process alive, so the SDK never delays the
 * host's exit. Node and Bun timers expose `unref()`. Deno timers are numeric
 * ids released through `Deno.unrefTimer`. Edge runtimes have neither, which is
 * fine: they do not wait on timers to exit.
 * @param {unknown} timer Value returned by `setTimeout` / `setInterval`.
 * @returns {void}
 */
export function unrefTimer(timer) {
  try {
    const t = /** @type {any} */ (timer);
    if (t && typeof t === "object" && typeof t.unref === "function") {
      t.unref();
    } else if (typeof t === "number") {
      const deno = /** @type {any} */ (globalThis).Deno;
      if (deno && typeof deno.unrefTimer === "function") deno.unrefTimer(t);
    }
  } catch {}
}

/**
 * Resolve after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for `promise`, but never longer than `ms`. The deadline timer is
 * cleared as soon as either side settles so it never holds the process open.
 * @param {Promise<unknown>} promise
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function withDeadline(promise, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise, deadline]).then(
    () => clearTimeout(timer),
    () => clearTimeout(timer),
  );
}
