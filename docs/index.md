# REVU Server SDK

`@revu-ai/server` runs inside your own web server and reports the crawler requests that reach it to REVU. It sees what a browser SDK cannot: AI crawlers, SEO tools and link-preview fetchers that download the raw HTML and never run JavaScript, including their reads of `robots.txt`, `llms.txt` and your sitemaps, with the real HTTP status and the real connecting IP.

> **Status:** `0.1.0` is the first release, and the REVU API route it reports to is live.

```js
import { createRevuServer } from "@revu-ai/server";
import { revuMiddleware } from "@revu-ai/server/node";

const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
app.use(revuMiddleware(revu)); // Express, Connect or node:http
```

Zero runtime dependencies. It runs on Node 20+, Bun, Deno, Cloudflare Workers and Next.js middleware, and any other stack can post to the same endpoint over [plain HTTP](./plain-http.md).

## How it works

1. An adapter turns each finished request into one `track()` call. `track()` is synchronous and never touches the network.
2. A cheap pre-filter keeps only page-like GET and HEAD requests from clients that look automated. Ordinary browser traffic is never sent.
3. Each kept request becomes a privacy-safe `$crawl` event: host, path, method, status, user agent, client IP, referer host and timestamp. Nothing else leaves your server.
4. Events are queued and sent in batches to one REVU endpoint, authenticated with your secret server key. Sending happens on a timer, or after the response on edge runtimes.
5. REVU re-classifies every hit, stores the crawler hits and verifies each crawler by its address, against the vendor's published addresses or reverse DNS. The package only captures and transports.

## A short tour

- **[Install](./install.md)** - the package, your server key, and a first reported hit.
- **[Setup by runtime](./runtimes.md)** - Express, Connect, `node:http`, Fastify, Next.js, Bun, Deno, Cloudflare Workers and any fetch-style handler.
- **[Configuration](./configuration.md)** - every option, the reporter methods and the exported helpers.
- **[Client IP and proxies](./client-ip.md)** - which address is reported, and when forwarding headers are trusted.
- **[What is reported](./reporting.md)** - the rules that decide whether a request is sent.
- **[Privacy and data](./privacy.md)** - the exact event, and what is never read or sent.
- **[Delivery and performance](./delivery.md)** - batching, retries, backoff, shutdown, and the guarantees that keep your server fast.
- **[Plain HTTP](./plain-http.md)** - report from PHP, Python, Ruby or any other stack.
- **[REVU API contract](./api-contract.md)** - the request, its limits and every response.
- **[Troubleshooting](./troubleshooting.md)** - no hits arriving, hits dropped by REVU, and proxy addresses in place of client addresses.

## Principles

- **Never slow or crash your server.** Every public function and adapter hook is wrapped. Internal errors are swallowed, and your own handler errors are re-thrown unchanged.
- **The request path never awaits the network.** Reporting costs a few string checks and one array push per request.
- **Privacy by construction.** Only the request fields above are sent, with an event type and a random event id. Bodies, cookies and other headers are never read.
- **Bounded everything.** A capped queue, one request in flight, a short timeout, at most one retry.
- **Zero runtime dependencies**, always. Platform APIs only.
