/**
 * @file Option resolution. Turns caller options into a fully populated,
 * validated config, or explains why the reporter must stay disabled. Invalid
 * numbers fall back to defaults rather than throwing: a typo in an option
 * must never take down the host server.
 */

/**
 * Default REVU API base URL: the production REVU API. Override it with the
 * `endpoint` option to point at a local or staging server.
 */
export const DEFAULT_ENDPOINT = "https://api.revu.ai";

/** Path of the ingest route, appended to the endpoint. */
export const INGEST_PATH = "/v1/behavior/server-events";

/** Prefix every secret server key carries. */
export const SERVER_KEY_PREFIX = "revu_sk_";

/** Prefix of the public browser key, which must never be used here. */
const PUBLIC_KEY_PREFIX = "revu_pk_";

/** Most events the REVU API accepts in one request. `maxBatchSize` is capped here. */
export const MAX_BATCH_SIZE = 500;

/** Numeric defaults, one place to read and tune them. */
export const DEFAULTS = Object.freeze({
  flushIntervalMs: 5000,
  flushAt: 20,
  minSendIntervalMs: 1000,
  maxBatchSize: 100,
  maxQueueSize: 1000,
  timeoutMs: 3000,
  retryDelayMs: 1000,
  backoffMs: 30000,
  maxBackoffMs: 300000,
  shutdownTimeoutMs: 5000,
});

/**
 * The fully resolved configuration used internally.
 *
 * @typedef {object} ResolvedConfig
 * @property {string} serverKey
 * @property {string} url Full ingest URL.
 * @property {boolean} debug
 * @property {boolean | number} trustProxy
 * @property {string | null} ipHeader Lowercased header name, or `null`.
 * @property {Set<string>} queryAllowlist
 * @property {Array<string | RegExp>} ignorePaths
 * @property {number} flushIntervalMs
 * @property {number} flushAt
 * @property {number} minSendIntervalMs
 * @property {number} maxBatchSize
 * @property {number} maxQueueSize
 * @property {number} timeoutMs
 * @property {number} retryDelayMs
 * @property {number} backoffMs
 * @property {number} maxBackoffMs
 * @property {number} shutdownTimeoutMs
 * @property {boolean} flushOnExit
 * @property {typeof fetch} fetch
 */

/**
 * Read a numeric option: a finite number `>= min`, else the default.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @returns {number}
 */
function num(value, fallback, min) {
  return typeof value === "number" && Number.isFinite(value) && value >= min
    ? Math.floor(value)
    : fallback;
}

/**
 * Read `trustProxy`. Accepts booleans and positive hop counts, and the same
 * values as strings (`"true"`, `"false"`, `"2"`), since the setting is often
 * read straight from an environment variable.
 * @param {unknown} value
 * @returns {boolean | number}
 */
function trustProxyOption(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (v === true || v === "true") return true;
  const hops = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
  return num(hops, 0, 1) || false;
}

/**
 * Resolve caller options into a {@link ResolvedConfig}.
 *
 * Returns `{ config }` on success or `{ problem }` with a human-readable
 * reason when the reporter cannot run (missing or wrong key, no `fetch`).
 * Never throws.
 *
 * @param {Partial<import("./types.js").RevuServerOptions> | null | undefined} options
 * @returns {{ config: ResolvedConfig, problem?: undefined } | { config?: undefined, problem: string }}
 */
export function resolveConfig(options) {
  const o = options && typeof options === "object" ? options : {};
  const key = typeof o.serverKey === "string" ? o.serverKey.trim() : "";

  if (!key) return { problem: "serverKey is missing. Reporting is disabled." };
  if (key.startsWith(PUBLIC_KEY_PREFIX)) {
    return {
      problem:
        "serverKey is a public browser key (revu_pk_). Use the secret server key (revu_sk_). Reporting is disabled.",
    };
  }
  if (!key.startsWith(SERVER_KEY_PREFIX)) {
    return { problem: "serverKey must start with revu_sk_. Reporting is disabled." };
  }

  const fetchImpl = typeof o.fetch === "function" ? o.fetch : globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { problem: "No fetch implementation is available. Reporting is disabled." };
  }

  const endpoint =
    typeof o.endpoint === "string" && o.endpoint.trim() ? o.endpoint.trim() : DEFAULT_ENDPOINT;

  const trustProxy = trustProxyOption(o.trustProxy);

  const maxBackoffMs = num(o.maxBackoffMs, DEFAULTS.maxBackoffMs, 0);

  return {
    config: {
      serverKey: key,
      url: endpoint.replace(/\/+$/, "") + INGEST_PATH,
      debug: o.debug === true,
      trustProxy,
      ipHeader:
        typeof o.ipHeader === "string" && o.ipHeader.trim()
          ? o.ipHeader.trim().toLowerCase()
          : null,
      queryAllowlist: new Set(
        Array.isArray(o.queryAllowlist)
          ? o.queryAllowlist.filter((k) => typeof k === "string" && k)
          : [],
      ),
      ignorePaths: Array.isArray(o.ignorePaths)
        ? o.ignorePaths.filter((p) => typeof p === "string" || p instanceof RegExp)
        : [],
      flushIntervalMs: num(o.flushIntervalMs, DEFAULTS.flushIntervalMs, 0),
      flushAt: num(o.flushAt, DEFAULTS.flushAt, 1),
      minSendIntervalMs: num(o.minSendIntervalMs, DEFAULTS.minSendIntervalMs, 0),
      maxBatchSize: Math.min(num(o.maxBatchSize, DEFAULTS.maxBatchSize, 1), MAX_BATCH_SIZE),
      maxQueueSize: num(o.maxQueueSize, DEFAULTS.maxQueueSize, 1),
      timeoutMs: num(o.timeoutMs, DEFAULTS.timeoutMs, 1),
      retryDelayMs: num(o.retryDelayMs, DEFAULTS.retryDelayMs, 0),
      backoffMs: Math.min(num(o.backoffMs, DEFAULTS.backoffMs, 0), maxBackoffMs),
      maxBackoffMs,
      shutdownTimeoutMs: num(o.shutdownTimeoutMs, DEFAULTS.shutdownTimeoutMs, 0),
      flushOnExit: o.flushOnExit !== false,
      fetch: fetchImpl,
    },
  };
}
