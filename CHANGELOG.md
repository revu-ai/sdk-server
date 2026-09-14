# Changelog

All notable changes to `@revu-ai/server` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

First release. Server-side crawler capture: the crawler requests that reach your own web server, including crawlers that never run JavaScript, are reported to REVU.

### Added

- **`createRevuServer({ serverKey, ... })`** returns a reporter with `track()`, `flush()` and `shutdown()`. Every method is wrapped so it can never throw into the host server. A missing or public (`revu_pk_`) key yields a disabled reporter that does nothing.
- **Pre-filter.** Only page-like GET and HEAD requests are considered (HTML documents plus `robots.txt`, `llms.txt`, `llms-full.txt` and sitemap files). Known asset extensions, `/api`, `/graphql`, `/_next/`, health endpoints (`/health`, `/healthz`, `/livez`, `/readyz`, `/ping`) and non-HTML responses are skipped, and `ignorePaths` adds your own. Health-check probes (`kube-probe`, `ELB-HealthChecker`, `GoogleHC`, `Consul Health Check`, `Envoy/HC`) are never reported. Redirects count whatever their content type. A user-agent check keeps ordinary browser traffic, and requests without a user agent, from ever being sent.
- **Privacy at the source.** Each `$crawl` event carries host, path, method, status, user agent, client IP, referer host and timestamp. The query string is stripped unless a parameter is listed in `queryAllowlist`, and path parameters (such as a `jsessionid=...` session id) are always stripped. Bodies, cookies and other headers are never read.
- **Trusted client IP.** `trustProxy` (hop count or `true`, also as a string from the environment) and `ipHeader` control when `X-Forwarded-For` or a single-value edge header is used. Otherwise the socket address is. With `ipHeader` set, a request without that header falls back to the socket address. With `trustProxy` on, the reported host comes from `X-Forwarded-Host` when present, so a site behind a reverse proxy reports its real host. With `debug` on, `trustProxy: true` without `ipHeader` logs a one-time warning, since clients control the leftmost `X-Forwarded-For` entry.
- **Bounded delivery.** A capped in-memory queue (oldest dropped when full), a flush every 5 s or at 20 hits, sends spaced at least 1 s apart (`minSendIntervalMs`) so a burst goes out as one batch, including on edge runtimes that flush after every hit, one request in flight, a 3 s timeout, one retry then drop, exponential backoff, `Retry-After` on 429, smaller batches after 413, and no sending after 401 until restart. A shared `beforeExit` hook makes one final attempt on natural exit, bounded by the timeout. `maxBatchSize` is capped at 500, the API limit, and each batch carries `sent_at` so REVU can correct clock skew. With `debug` on, each send logs REVU's per-hit counts (accepted, duplicates and rejections by reason).
- **Adapters.** `@revu-ai/server/node` (`node:http`, Express, Connect), `/fastify`, `/fetch` (any fetch-style handler), `/bun`, `/deno`, `/cloudflare` (options built from `env`, flush through `ctx.waitUntil`) and `/next` (middleware, flush through `event.waitUntil`).
- **Types.** `.d.ts` declarations generated from JSDoc for every entry point.
- **Zero runtime dependencies.** Runs on Node 20+, Bun, Deno, Cloudflare Workers and Next.js middleware.
