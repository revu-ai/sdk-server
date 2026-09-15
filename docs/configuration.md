# Configuration

`createRevuServer(options)` returns a reporter. Only `serverKey` is required. Options never throw: invalid numeric values fall back to their defaults, and a missing, malformed or public key yields a disabled reporter that does nothing.

```js
import { createRevuServer } from "@revu-ai/server";

const revu = createRevuServer({
  serverKey: process.env.REVU_SERVER_KEY,
  trustProxy: process.env.REVU_TRUST_PROXY, // "1", "2" or "true", read from the environment
  queryAllowlist: ["page"],
  ignorePaths: ["/admin", /^\/preview\//],
});
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `serverKey` | required | Secret server key for one environment, `revu_sk_prod_...` (or `_stg_`, `_dev_`). Missing, malformed or public keys disable the reporter. |
| `endpoint` | `https://api.revu.ai` | REVU API base URL. Events go to `{endpoint}/v1/behavior/server-events`. Override it to point at a local or staging server. |
| `debug` | `false` | Log internal errors and send outcomes to `console.warn`, including REVU's per-hit counts for each send. Silent otherwise. |
| `trustProxy` | `false` | `false`: socket address only. A number `n`: `n` trusted proxies, take the `n`th `X-Forwarded-For` entry from the right. `true`: leftmost entry (any client can set it, prefer a hop count or `ipHeader`). String forms (`"true"`, `"2"`) are accepted for values read from the environment. When on, the reported host also comes from `X-Forwarded-Host`. |
| `ipHeader` | none | Single-value client IP header set by your trusted edge (`cf-connecting-ip`, `x-real-ip`, ...). Used only when `trustProxy` is on. When set, it replaces `X-Forwarded-For`: a request without it falls back to the socket address. |
| `queryAllowlist` | `[]` | Query parameters kept on the reported path. Everything else is stripped. |
| `ignorePaths` | `[]` | Extra paths never reported: prefixes (`"/admin"`) or `RegExp`. Added to the built-in ignores. |
| `shouldReport` | none | Your own last check, `(request) => boolean`, for rules the path cannot express (a header, a host, the client address). It runs only for hits that pass every built-in filter and `ignorePaths`, and gets the same request `track()` got. `false` drops the hit. Keep it synchronous. A check that throws drops the hit. |
| `flushIntervalMs` | `5000` | Send cadence. `0` turns the timer off. |
| `flushAt` | `20` | Queue length that triggers an early send. |
| `minSendIntervalMs` | `1000` | Shortest gap between two sends. Hits that arrive within it go out together, so a burst becomes one request. A hit after a quiet interval is sent at once. `0` never waits. The exit flush and `shutdown()` never wait. |
| `maxBatchSize` | `100` | Hits per request, at most 500. |
| `maxQueueSize` | `1000` | Queue cap. When full, the oldest hit is dropped. |
| `timeoutMs` | `3000` | Per-request timeout. |
| `retryDelayMs` | `1000` | Delay before the single retry. |
| `backoffMs` | `30000` | Pause after a failed or throttled send. Doubles per consecutive failure, resets on success. |
| `maxBackoffMs` | `300000` | Upper bound for the pause. |
| `shutdownTimeoutMs` | `5000` | Longest `shutdown()` waits. |
| `flushOnExit` | `true` | Flush on the process `beforeExit` event (Node, Bun). |
| `fetch` | global `fetch` | Custom `fetch` implementation. |

The client IP options are explained with worked setups in [Client IP and proxies](./client-ip.md). The delivery options are explained in [Delivery and performance](./delivery.md).

## The reporter

| Method | Description |
| --- | --- |
| `track(request)` | Filter, build and queue one hit. Synchronous. Returns `true` when queued. |
| `flush()` | Send what is queued now. Resolves when drained or paused. Never rejects. |
| `shutdown()` | Stop accepting hits and make a final bounded flush. |

The adapters call `track()` for you. Call it yourself only for a server without an adapter, see [Calling track() yourself](./runtimes.md#calling-track-yourself).

## Exported helpers

The package also exports the pure helpers the reporter uses, for custom integrations:

- `isPageRequest` - the page rules from [What is reported](./reporting.md).
- `looksAutomated` - the user-agent pre-filter.
- `resolveClientIp` and `normalizeIp` - the client IP rules from [Client IP and proxies](./client-ip.md).
- `VERSION`, `DEFAULT_ENDPOINT` and `INGEST_PATH`.

## Types

Every option, method and adapter is typed. The `.d.ts` declarations ship with the package and are generated from the JSDoc in the source, so editor hints and these docs describe the same surface.
