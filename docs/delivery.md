# Delivery and performance

Reporting must never cost your server anything noticeable. This page covers how hits travel from `track()` to REVU, what happens when REVU is slow or unreachable, and the guarantees that hold throughout.

## From track() to REVU

1. `track()` runs the pre-filter, builds the event and pushes it onto an in-memory queue. It is synchronous and never touches the network.
2. The queue is sent every `flushIntervalMs` (5 s), or sooner once it holds `flushAt` hits (20). An early send is deferred to a later tick, never run inside the request that triggered it.
3. On edge runtimes (Cloudflare Workers, Next.js middleware, any handler with `waitUntil`), each reported hit is flushed through `waitUntil` after the response instead, so the runtime keeps the send alive without delaying the response.
4. Sends are spaced at least `minSendIntervalMs` (1 s) apart. A hit that arrives within a second of the last send waits for the rest of that second, and every hit tracked meanwhile joins the same batch. A burst of crawler hits therefore costs one request, not one per hit, while a hit after a quiet second is sent at once. On edge runtimes the wait runs inside `waitUntil`, after the response.
5. Hits are sent in batches of up to `maxBatchSize` (100, at most 500), one request in flight at a time, each with a `timeoutMs` deadline (3 s).
6. Every batch carries `sent_at`, your server's clock at send time, so REVU can correct event timestamps for clock skew.

## When a send fails

| Outcome | What the reporter does |
| --- | --- |
| `2xx` | Done. The backoff resets. |
| `401` / `403` | The key was refused. Sending stops until restart, logged once in debug. |
| `413` | The batch was too large. It is dropped, the batch size is halved, and sending pauses. |
| `429` | Throttled (the key's rate limit, or too many unknown keys from your address). The batch is kept and sending pauses for `Retry-After` (or the backoff). |
| `408`, `5xx`, network error or timeout | One retry after `retryDelayMs`, then the batch is dropped and sending pauses. |
| other `4xx` | The batch is dropped with no retry. |

A pause starts at `backoffMs` (30 s), doubles with each consecutive failure up to `maxBackoffMs` (5 min), and resets after a successful send. Hits tracked during a pause wait in the queue.

## Shutdown

- **Natural exit.** On Node and Bun, a shared `beforeExit` hook makes one final send attempt with no retry, so exit waits at most `timeoutMs` for an unresponsive endpoint. It never waits for the send interval. Set `flushOnExit: false` to turn it off.
- **Signals.** Call `await revu.shutdown()` from your own `SIGTERM` handler. It stops accepting hits and makes a final flush bounded by `shutdownTimeoutMs` (5 s). See [Shutting down](./runtimes.md#shutting-down).
- **Edge runtimes** need no shutdown step, since each hit is flushed after its own response.
- **Serverless functions without `waitUntil`** must call `await revu.flush()` before returning, see [Serverless functions without waitUntil](./runtimes.md#serverless-functions-without-waituntil).

## Guarantees

- **Never crashes your server.** Every public function and every adapter hook is wrapped. Internal errors are swallowed (logged only with `debug: true`). Errors thrown by your own handlers are re-thrown unchanged.
- **Never blocks a request.** `track()` is a few string checks and one array push. The request path never awaits the network.
- **Bounded exit.** The flush timer is unreferenced, so it never keeps a process alive.
- **Bounded memory.** At most `maxQueueSize` hits (1000) are held. When the queue is full, the oldest hit is dropped first.
- **Bounded network.** One request in flight, sends spaced at least `minSendIntervalMs` apart, a deadline on every request, at most one retry, then drop and back off.
- **Tiny volume.** Only crawler page hits are sent, in batches.

## Size

Each entry point bundled on its own and minified, as an edge bundle would include it:

| Entry | Minified | Gzipped |
| --- | --- | --- |
| `@revu-ai/server` (core) | 12.76 kB | 5.36 kB |
| `/cloudflare` (includes the core) | 13.56 kB | 5.60 kB |
| `/node`, `/fastify`, `/fetch`, `/bun`, `/deno`, `/next` | 0.5 to 1.2 kB | 0.35 to 0.71 kB |

Size budgets are enforced on every change, so these numbers only move deliberately.
