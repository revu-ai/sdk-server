/**
 * @file Shared JSDoc types for the REVU Server SDK. This module has no runtime
 * code. `tsc` turns these typedefs into the published `.d.ts` declarations.
 */

/**
 * Options accepted by {@link import("./reporter.js").createRevuServer}. Only
 * `serverKey` is required. Every other option has a production default.
 *
 * @typedef {object} RevuServerOptions
 * @property {string} serverKey
 *   Secret server key (`revu_sk_...`). Keep it in an environment variable or
 *   secret store. Never ship it to a browser. A public browser key
 *   (`revu_pk_...`) is rejected and the reporter stays disabled.
 * @property {string} [endpoint]
 *   Base URL of the REVU API. Events are posted to
 *   `{endpoint}/v1/behavior/server-events`. Defaults to
 *   {@link import("./config.js").DEFAULT_ENDPOINT}.
 * @property {boolean} [debug=false]
 *   Log internal errors and send outcomes to `console.warn`. Off in
 *   production. The SDK is silent by default.
 * @property {boolean | number | string} [trustProxy=false]
 *   Whether forwarding headers may be used to find the client IP.
 *   `false` uses only the connecting socket address. A number `n` means `n`
 *   trusted proxies sit in front of the server, so the client is the `n`th
 *   `X-Forwarded-For` entry from the right. `true` trusts every hop and takes
 *   the leftmost entry (only safe when your edge overwrites the header, so
 *   prefer a hop count or `ipHeader`).
 *   String forms (`"true"`, `"2"`) are accepted for values read from the
 *   environment. When enabled, the reported host is also taken from
 *   `X-Forwarded-Host` (its first entry) when present, so a site behind a
 *   reverse proxy reports its real host rather than the proxy's upstream.
 * @property {string} [ipHeader]
 *   A single-value client IP header set by your trusted edge, for example
 *   `cf-connecting-ip`, `x-real-ip` or `fly-client-ip`. Read only when
 *   `trustProxy` is enabled. When set, it replaces `X-Forwarded-For`
 *   entirely: a request without it falls back to the socket address.
 * @property {string[]} [queryAllowlist=[]]
 *   Query parameter names kept on the reported path. Everything else in the
 *   query string is stripped. Empty by default: no query string is sent.
 * @property {Array<string | RegExp>} [ignorePaths=[]]
 *   Extra paths never reported, as path prefixes (`"/admin"`) or regular
 *   expressions tested against the path. Added to the built-in ignores
 *   (`/api`, `/graphql`, `/_next/` and the health endpoints `/health`,
 *   `/healthz`, `/livez`, `/readyz`, `/ping`).
 * @property {number} [flushIntervalMs=5000]
 *   How often queued hits are sent. `0` disables the timer (edge adapters
 *   flush after each response instead).
 * @property {number} [flushAt=20]
 *   Queue length that triggers an early flush.
 * @property {number} [maxBatchSize=100]
 *   Maximum hits per request, at most 500 (the REVU API limit).
 * @property {number} [minSendIntervalMs=1000]
 *   Shortest gap between two sends. Hits that arrive within it wait and go
 *   out together, so a burst (edge adapters flush after every reported hit)
 *   becomes one request instead of one per hit, while a hit after a quiet
 *   interval is sent at once. `0` never waits. The exit flush and
 *   `shutdown()` never wait.
 * @property {number} [maxQueueSize=1000]
 *   Hard cap on queued hits. When full, the oldest hit is dropped.
 * @property {number} [timeoutMs=3000]
 *   Per-request network timeout.
 * @property {number} [retryDelayMs=1000]
 *   Delay before the single retry of a failed send.
 * @property {number} [backoffMs=30000]
 *   Initial pause after a failed or throttled send. Doubles on each
 *   consecutive failure up to `maxBackoffMs` and resets on success.
 * @property {number} [maxBackoffMs=300000]
 *   Upper bound for the pause.
 * @property {number} [shutdownTimeoutMs=5000]
 *   Longest `shutdown()` waits for the final flush.
 * @property {boolean} [flushOnExit=true]
 *   On Node and Bun, flush once when the process is about to exit naturally
 *   (`beforeExit`). The exit flush makes one attempt per batch with no retry,
 *   so exit waits at most `timeoutMs` for an unresponsive endpoint. Signals
 *   are left to the host. Call `shutdown()` from your own `SIGTERM` handler.
 * @property {typeof fetch} [fetch]
 *   Custom `fetch` implementation. Defaults to the global `fetch`.
 */

/**
 * One inbound request, described in runtime-neutral terms. Adapters build this
 * from their framework's request and response. A custom integration can build
 * it by hand and call `track()` directly.
 *
 * @typedef {object} RequestInfo
 * @property {string} method HTTP method, for example `"GET"`.
 * @property {string} url
 *   Request target: a path with optional query (`"/blog?page=2"`) or an
 *   absolute URL. Only the path (and allowlisted query parameters) is sent.
 * @property {number | null} [status]
 *   Final HTTP status of the response, or `null` when it is not known (for
 *   example in Next.js middleware, which runs before the page renders).
 * @property {string | null} [contentType]
 *   Response `Content-Type`, used to skip non-HTML responses. Omit when
 *   unknown. The path-based filter then decides alone.
 * @property {import("./utils.js").HeadersLike | null} [headers]
 *   Request headers. Only `host`, `user-agent`, `referer` and, when trusted,
 *   the forwarding headers are read. Nothing else is inspected or sent.
 * @property {string | null} [remoteAddress]
 *   Address of the directly connected peer (the socket address, or the
 *   platform-provided client IP on edge runtimes).
 * @property {Date | number | string} [timestamp]
 *   When the request arrived. Defaults to the time `track()` is called.
 */

/**
 * The wire shape of one crawler hit, as posted to the REVU API.
 *
 * @typedef {object} CrawlEvent
 * @property {"$crawl"} event_type Always `"$crawl"`.
 * @property {string} event_id Random UUID, for idempotent ingest.
 * @property {string} timestamp ISO-8601 time the request arrived.
 * @property {string} host Request host, lowercased (may include a port).
 * @property {string} path Path, plus allowlisted query parameters only.
 * @property {string} method HTTP method, uppercased.
 * @property {number | null} status HTTP status, or `null` when unknown.
 * @property {string} user_agent User agent string (empty when absent).
 * @property {string | null} ip Client IP, or `null` when it cannot be determined.
 * @property {string | null} referer_host Hostname of the `Referer`, never the full URL.
 */

/**
 * The reporter returned by `createRevuServer()`. Every method is safe to call
 * at any time and never throws.
 *
 * @typedef {object} RevuServer
 * @property {(request: RequestInfo) => boolean} track
 *   Record one request. Synchronous and cheap: it filters, builds the event
 *   and queues it, and never touches the network. Returns `true` when the
 *   request was queued for reporting.
 * @property {() => Promise<void>} flush
 *   Send everything queued now. Resolves when the queue is drained or sending
 *   is paused. Never rejects. On edge runtimes pass it to `waitUntil`.
 * @property {() => Promise<void>} shutdown
 *   Stop accepting hits, stop the timer and make a final bounded flush.
 */

export {};
