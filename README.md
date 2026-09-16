# @revu-ai/server

The REVU Server SDK. It runs inside your own web server and reports the crawler requests that reach it to REVU.

REVU's browser SDK sees crawlers that execute JavaScript. Most AI crawlers, SEO tools and link-preview fetchers never do: they download the raw HTML and leave. The only place those requests are visible is your server. This package captures them there, including reads of `robots.txt`, `llms.txt` and your sitemaps, with the real HTTP status and the real connecting IP, and sends them to REVU. It talks only to REVU, never to any other service.

```js
import { createRevuServer } from "@revu-ai/server";
import { revuMiddleware } from "@revu-ai/server/node";

const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
app.use(revuMiddleware(revu)); // Express, Connect or node:http
```

Zero runtime dependencies. Node 20+, Bun, Deno, Cloudflare Workers and Next.js middleware. Core: 12.76 kB minified, 5.36 kB gzipped.

Documentation: [developers.revu.ai/server](https://developers.revu.ai/server/)

> **Status: 0.1.0, the first release.** The REVU API route this package reports to is live. See [REVU API contract](#revu-api-contract).

## Contents

- [Install](#install)
- [Setup by runtime](#setup-by-runtime)
- [Configuration](#configuration)
- [Client IP and proxies](#client-ip-and-proxies)
- [What is reported](#what-is-reported)
- [What is sent, and what never is](#what-is-sent-and-what-never-is)
- [Performance guarantees](#performance-guarantees)
- [Any other language: plain HTTP](#any-other-language-plain-http)
- [REVU API contract](#revu-api-contract)
- [Why one package](#why-one-package)
- [Size](#size)
- [Versioning](#versioning)
- [Development](#development)

## Install

```bash
npm install @revu-ai/server
```

```bash
bun add @revu-ai/server
```

Create one reporter per process with your **secret server key** (`revu_sk_...`). Keep it in an environment variable or secret store. It is not the public browser key (`revu_pk_...`) used by the web SDK. A public key is refused and the reporter stays disabled. Each key belongs to one environment and carries it in its prefix (`revu_sk_prod_...`, `revu_sk_stg_...`, `revu_sk_dev_...`), so create one key per environment and deploy each environment with its own key, for example a `REVU_SERVER_KEY` set per deploy. Create keys in REVU on your website's touchpoint (Settings > Touchpoints, the environment's tab, the Server capture card). A key is shown once. Organization owners and admins can create and revoke keys, and each environment can have up to 5 active keys, so a key can be rotated without a gap. A staging key needs the touchpoint's staging domain to be set first.

A key accepts only the hosts of its own environment: that environment's domain and its subdomains, and `localhost` for the development key. Hits for any other host are dropped, so a production key refuses `localhost`. Use the development key to try the SDK on your machine.

## Setup by runtime

Every adapter is a subpath of the same package and uses the same reporter.

### Express, Connect, node:http

```js
import express from "express";
import { createRevuServer } from "@revu-ai/server";
import { revuMiddleware } from "@revu-ai/server/node";

const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });

const app = express();
app.use(revuMiddleware(revu)); // register first so every route is seen
```

Plain `node:http`:

```js
import http from "node:http";

const track = revuMiddleware(revu);
http.createServer((req, res) => {
  track(req, res); // no next(): it only observes
  handle(req, res);
});
```

The hit is recorded on the response `finish` event, so the status and content type are final.

### Fastify

```js
import Fastify from "fastify";
import { createRevuServer } from "@revu-ai/server";
import { fastifyRevu } from "@revu-ai/server/fastify";

const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
const app = Fastify();
await app.register(fastifyRevu(revu)); // applies to every route
app.addHook("onClose", () => revu.shutdown());
```

### Next.js (middleware)

```js
// middleware.js
import { createRevuServer } from "@revu-ai/server";
import { withRevu } from "@revu-ai/server/next";

const revu = createRevuServer({
  serverKey: process.env.REVU_SERVER_KEY,
  trustProxy: 1,
  flushIntervalMs: 0, // each hit is flushed through event.waitUntil
});

export default withRevu(revu); // or withRevu(revu, yourMiddleware)

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

Middleware runs before the page renders, so the final status is only known when your middleware answers itself (a redirect or a direct response). When it lets the request continue, the hit is sent with `status: null`, and REVU counts it as coverage even if the page then renders a 404. The send is handed to `event.waitUntil`. Set `trustProxy` to match your hosting, see [Client IP and proxies](#client-ip-and-proxies).

### Bun

Wrap both `routes` and `fetch`. Bun answers a path that matches `routes` without calling `fetch`, so `withRevu` alone reports only the paths no route matches.

```js
import { createRevuServer } from "@revu-ai/server";
import { withRevu, withRevuRoutes } from "@revu-ai/server/bun";

const revu = createRevuServer({ serverKey: Bun.env.REVU_SERVER_KEY });

Bun.serve({
  routes: withRevuRoutes(revu, {
    "/": renderHome, // your handlers
    "/pricing": { GET: renderPricing },
    "/robots.txt": Bun.file("public/robots.txt"),
  }),
  fetch: withRevu(revu, handleNotFound), // paths no route matches
});
```

`withRevuRoutes` wraps handler functions and each method of a per-method route. Static `Response` and `Bun.file` routes are served through a handler that returns a copy, so crawler reads of them are reported, but Bun no longer answers them with `304 Not Modified`. HTML imports and `false` routes pass through untouched and are not reported. An app with only `fetch` needs only `withRevu`.

### Deno

```js
import { createRevuServer } from "npm:@revu-ai/server";
import { withRevu } from "npm:@revu-ai/server/deno";

const revu = createRevuServer({ serverKey: Deno.env.get("REVU_SERVER_KEY") });

Deno.serve(withRevu(revu, (request, info) => new Response("hello")));
```

### Cloudflare Workers

Secrets live on `env`, which exists only inside a request, so pass a function that builds the options. The reporter is created once per isolate, the client IP comes from `CF-Connecting-IP`, and every reported hit is flushed through `ctx.waitUntil` after the response. Sends are spaced at least `minSendIntervalMs` (1 s) apart, so a burst of crawler hits goes out as one batch rather than one request per hit.

```js
import { withRevu } from "@revu-ai/server/cloudflare";

export default {
  fetch: withRevu(
    (env) => ({ serverKey: env.REVU_SERVER_KEY }),
    async (request, env, ctx) => fetch(request), // your Worker
  ),
};
```

### Any fetch-style handler

For any runtime or framework built on `(request: Request, ...rest) => Response`:

```js
import { withRevu } from "@revu-ai/server/fetch";

export default {
  fetch: withRevu(revu, app.fetch, {
    getRemoteAddress: (request, ...rest) => null, // the client address, if the runtime exposes it
    getWaitUntil: (request, ...rest) => null, // the runtime's waitUntil, if it has one
  }),
};
```

### Calling `track()` yourself

```js
revu.track({
  method: "GET",
  url: "/pricing?page=2", // path or absolute URL
  status: 200,
  contentType: "text/html",
  headers: request.headers, // Headers or a plain object with lowercase keys
  remoteAddress: socketAddress,
});
```

`track()` is synchronous, never throws, never touches the network, and returns `true` when the hit was queued.

### Shutting down

On a natural exit, Node and Bun flush once automatically (`beforeExit`). That final flush makes one attempt with no retry, so exit waits at most `timeoutMs` for an unresponsive endpoint. Signals are left to you, so add the flush to your own handler:

```js
process.on("SIGTERM", async () => {
  await revu.shutdown(); // bounded by shutdownTimeoutMs
  process.exit(0);
});
```

Serverless functions without `waitUntil` (AWS Lambda style) are frozen once they return, so the flush timer never fires. Call `await revu.flush()` before returning, with a short `timeoutMs` and `minSendIntervalMs: 0`, since the flush waits for the send.

## Configuration

`createRevuServer(options)`. Only `serverKey` is required.

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

Invalid numeric values fall back to their defaults. Options never throw.

The reporter:

| Method | Description |
| --- | --- |
| `track(request)` | Filter, build and queue one hit. Synchronous. Returns `true` when queued. |
| `flush()` | Send what is queued now. Resolves when drained or paused. Never rejects. |
| `shutdown()` | Stop accepting hits and make a final bounded flush. |

The package also exports the pure helpers the reporter uses, for custom integrations: `isPageRequest`, `looksAutomated`, `resolveClientIp`, `normalizeIp`, plus `VERSION`, `DEFAULT_ENDPOINT` and `INGEST_PATH`.

## Client IP and proxies

REVU verifies every reported crawler by the address it connected from: an address in the vendor's published list, or a reverse DNS name the vendor documents, confirmed by a forward lookup. So the SDK must report the address the crawler connected from, not your proxy's. Forwarding headers can be forged by any client, so they are read only when you say a proxy you control sets them.

| Your setup | Setting |
| --- | --- |
| Server receives connections directly | default (`trustProxy: false`) |
| One reverse proxy or load balancer in front | `trustProxy: 1` |
| Two proxies in front (for example a CDN, then a load balancer) | `trustProxy: 2` |
| Your edge sets a single trusted client IP header | `trustProxy: true, ipHeader: "<header name>"` |
| Cloudflare in front of your origin (proxied DNS) | `trustProxy: true, ipHeader: "cf-connecting-ip"` (only when your origin accepts traffic from Cloudflare alone, otherwise a client can set that header) |
| Cloudflare Workers adapter | nothing: `CF-Connecting-IP` is used automatically |
| Platform that sets `X-Forwarded-For` itself | `trustProxy: 1` (check your platform's documentation for how it sets the header) |

`trustProxy: true` takes the leftmost `X-Forwarded-For` entry and is only safe when your edge replaces, rather than appends to, the header clients send. Prefer a hop count or `ipHeader`, since a spoofed address defeats crawler verification. With `debug` on, the SDK warns once when `true` is used without `ipHeader`. A wrong setting shows up in AI visibility: behind a proxy with no setting, your real crawlers fail verification and are listed as spoofed, or stay unverifiable when the proxy is a CDN edge (Cloudflare, Fastly or Akamai). With a hop count, the address is taken from the right, where only your own proxies write. With `ipHeader` set, `X-Forwarded-For` is never read: a request that arrives without that header (one that bypassed your edge) is attributed to its socket address.

With `trustProxy` on, the reported host also comes from `X-Forwarded-Host` (its first entry) when present. A reverse proxy often passes its upstream name (`127.0.0.1:3000`) as `Host`, which REVU cannot match to your touchpoint's domains.

## What is reported

A request is reported only when all of these hold:

1. **Method** is GET or HEAD.
2. **Path** is page-like: an HTML document, or `robots.txt`, `llms.txt`, `llms-full.txt` or a sitemap file (`*sitemap*.xml`, `.xml.gz`). Paths whose last segment has a known asset extension (`.js`, `.css`, `.png`, `.json`, `.pdf`, ...) are skipped, while paths that merely contain a dot (`/user/john.doe`) still count. `/api`, `/graphql`, `/_next/`, health endpoints (`/health`, `/healthz`, `/livez`, `/readyz`, `/ping`) and your `ignorePaths` are skipped.
3. **Response** is HTML, when the content type is known. Crawler files and redirects (3xx) count whatever their content type.
4. **User agent looks automated**: not starting with `Mozilla/` (command-line tools and HTTP libraries), or carrying a crawler token (bot, crawler, spider, preview and fetcher names, headless browsers, a `+http` contact URL). Requests without a user agent are not reported, since REVU classifies each hit by it. Health-check probes (`kube-probe`, `ELB-HealthChecker`, `GoogleHC`, `Consul Health Check`, `Envoy/HC`) are never reported.

Step 4 is a cheap pre-filter, not the verdict. It is generous on purpose. REVU re-classifies every hit and discards the ones it decides are human. What it guarantees is that ordinary browser traffic is never sent.

## What is sent, and what never is

One `$crawl` event per reported request:

```json
{
  "event_type": "$crawl",
  "event_id": "7a0c3e2e-6d1b-4b8e-9f51-2f0b1d7e9c44",
  "timestamp": "2026-09-15T10:21:04.512Z",
  "host": "shop.example",
  "path": "/pricing",
  "method": "GET",
  "status": 200,
  "user_agent": "Mozilla/5.0 (compatible; ExampleBot/1.0; +https://example.com/bot)",
  "ip": "203.0.113.7",
  "referer_host": null
}
```

- **Path** has its query string removed unless a parameter is in `queryAllowlist`. Path parameters (everything from the first semicolon in the path, such as a `jsessionid=...` session id) and fragments are never sent.
- **Referer** is reduced to its hostname. The referring URL's path and query are never sent.
- **Lengths are capped**: host 255, path 1024, user agent 512 characters.
- **Never read, never sent**: request or response bodies, cookies, `Authorization`, and every header other than `Host`, `User-Agent`, `Referer` and, when trusted, the forwarding headers.
- **Browser traffic** is filtered out before anything is built.

## Performance guarantees

- **Never crashes your server.** Every public function and every adapter hook is wrapped. Internal errors are swallowed (logged only with `debug: true`). Errors thrown by your own handlers are re-thrown unchanged.
- **Never blocks a request.** `track()` is synchronous: a few string checks and one array push. The request path never awaits the network. Sending happens on a timer, or after the response through `waitUntil` on edge runtimes. An early flush at `flushAt` is deferred to a later tick, never run inside the request that triggered it.
- **Bounded exit.** The flush timer is unreferenced, so it never keeps a process alive. The one exit flush makes a single attempt, so a natural exit waits at most `timeoutMs` (3 s by default) for an unresponsive endpoint.
- **Bounded memory.** At most `maxQueueSize` hits are held. The oldest is dropped first.
- **Bounded network.** One request in flight, sends spaced at least `minSendIntervalMs` apart, a `timeoutMs` deadline, one retry, then drop and back off. `429` waits for `Retry-After`, `413` halves the batch size, `401` or `403` stops reporting until restart.
- **Tiny volume.** Only crawler page hits are sent, in batches of up to 100.

## Any other language: plain HTTP

Any stack can report directly by posting to the contract below. Apply the same rules this package applies ([What is reported](#what-is-reported)), send after the response is delivered, keep a short timeout, and never let a failure reach the request. Batch where your runtime allows it. Each `event_id` must be a UUID. These snippets are illustrative starting points, each sending a single event.

**PHP** (after the response, under PHP-FPM):

```php
<?php
fastcgi_finish_request(); // response is delivered, the rest runs after
$id = random_bytes(16);
$id[6] = chr(ord($id[6]) & 0x0f | 0x40); // UUID version 4
$id[8] = chr(ord($id[8]) & 0x3f | 0x80); // RFC 4122 variant
$event = [
  'event_type' => '$crawl',
  'event_id' => vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($id), 4)),
  'timestamp' => gmdate('Y-m-d\TH:i:s.v\Z'),
  'host' => strtolower($_SERVER['HTTP_HOST'] ?? ''),
  'path' => strtok($_SERVER['REQUEST_URI'], '?'),
  'method' => $_SERVER['REQUEST_METHOD'],
  'status' => http_response_code(),
  'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
  'ip' => $_SERVER['REMOTE_ADDR'] ?? null,
  'referer_host' => parse_url($_SERVER['HTTP_REFERER'] ?? '', PHP_URL_HOST) ?: null,
];
$ch = curl_init('https://api.revu.ai/v1/behavior/server-events');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . getenv('REVU_SERVER_KEY')],
  CURLOPT_POSTFIELDS => json_encode(['sdk' => ['name' => 'custom-php', 'version' => '1'], 'events' => [$event]]),
  CURLOPT_TIMEOUT_MS => 3000,
  CURLOPT_RETURNTRANSFER => true,
]);
@curl_exec($ch);
```

**Python** (standard library, off the request thread):

```python
import json, os, threading, urllib.request, uuid
from datetime import datetime, timezone

def report(event):
    def send():
        body = json.dumps({"sdk": {"name": "custom-python", "version": "1"}, "events": [event]}).encode()
        req = urllib.request.Request(
            "https://api.revu.ai/v1/behavior/server-events",
            data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer " + os.environ["REVU_SERVER_KEY"]},
        )
        try:
            urllib.request.urlopen(req, timeout=3).close()
        except Exception:
            pass  # never let reporting fail a request
    threading.Thread(target=send, daemon=True).start()

report({
    "event_type": "$crawl", "event_id": str(uuid.uuid4()),
    "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
    "host": "shop.example", "path": "/pricing", "method": "GET", "status": 200,
    "user_agent": "curl/8.7.1", "ip": "203.0.113.7", "referer_host": None,
})
```

**Ruby** (standard library, off the request thread):

```ruby
require "net/http"
require "json"
require "securerandom"
require "time"

def revu_report(event)
  Thread.new do
    uri = URI("https://api.revu.ai/v1/behavior/server-events")
    Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 3, read_timeout: 3) do |http|
      http.post(uri.path,
                { sdk: { name: "custom-ruby", version: "1" }, events: [event] }.to_json,
                "Content-Type" => "application/json",
                "Authorization" => "Bearer #{ENV.fetch("REVU_SERVER_KEY")}")
    end
  rescue StandardError
    nil # never let reporting fail a request
  end
end

revu_report(event_type: "$crawl", event_id: SecureRandom.uuid, timestamp: Time.now.utc.iso8601(3),
            host: "shop.example", path: "/pricing", method: "GET", status: 200,
            user_agent: "curl/8.7.1", ip: "203.0.113.7", referer_host: nil)
```

## REVU API contract

The request this package sends and how it reacts to each answer. The package and its tests are built against it (with a local fake server). Any stack can post to it directly, see [Any other language: plain HTTP](#any-other-language-plain-http).

```
POST {endpoint}/v1/behavior/server-events
Authorization: Bearer revu_sk_prod_...
Content-Type: application/json
```

```json
{
  "sdk": { "name": "@revu-ai/server", "version": "0.1.0" },
  "sent_at": "<ISO-8601>",
  "events": [
    {
      "event_type": "$crawl",
      "event_id": "<uuid>",
      "timestamp": "<ISO-8601>",
      "host": "shop.example",
      "path": "/pricing",
      "method": "GET",
      "status": 200,
      "user_agent": "...",
      "ip": "203.0.113.7",
      "referer_host": null
    }
  ]
}
```

- **At most 500 events and 1 MB** per request.
- **Each event is checked on its own.** An invalid event is dropped and the rest of the batch is kept. `event_id` must be a UUID, `path` must start with `/`, `user_agent` must not be empty, and `status` may be `null`.
- **`host` must belong to the key's environment**: that environment's domain or a subdomain of it, and also `localhost` for a development key. When domains overlap, the most specific one decides (`staging.acme.com` is staging even under `acme.com`). A port is ignored. Hits for any other host are dropped, for example `localhost` sent with a production key.
- **Hits REVU does not recognize as automated are dropped**, and their IP is not stored. That covers browsers and user agents that match no known crawler, bot or HTTP client.
- **`ip` is how REVU verifies the crawler**, against its vendor's published addresses or by reverse DNS. The check runs after the response, so a hit from an address the vendor does not use is still accepted and counted in `accepted`, then left out of AI visibility as spoofed. A missing `ip`, an address on a CDN edge network (Cloudflare, Fastly or Akamai), or a crawler whose vendor documents no way to check leaves the hit unverifiable, and it still counts. The IP is cleared after 30 days, and the hit itself is kept.
- **`event_id` is an idempotency key.** A batch sent twice is stored once.
- **`sent_at` is optional**: the sender's clock at send time, used to correct event timestamps for clock skew. A timestamp more than 5 minutes ahead is replaced by the time of receipt. A hit more than 7 days old is rejected as invalid.

A `202` counts what happened to each event:

```json
{ "accepted": 2, "duplicates": 0, "rejected": { "invalid": 0, "unknown_host": 1, "not_crawler": 0 } }
```

| Response | Meaning | Client behavior |
| --- | --- | --- |
| `202` (any 2xx) | Accepted. | Done. |
| `401` | Missing, malformed, public or unknown key, or the key's environment is turned off on the touchpoint. | Stop sending until restart, logged once in debug. |
| `403` | Revoked key, its touchpoint is archived or is not a website, or the request came from a browser (it carried an `Origin` header). | Stop sending until restart, logged once in debug. |
| `413` | More than 500 events or 1 MB. | Drop the batch, halve the batch size, back off. |
| `429` | The key's rate limit, or too many requests with unknown keys from your address, with `Retry-After` in seconds. | Keep the batch, pause for `Retry-After` (or the backoff). |
| `408` / `5xx` / network error / timeout | Temporary failure. | One retry after `retryDelayMs`, then drop and back off. |
| other `4xx` | A malformed request body. | Drop the batch, no retry. |

## Why one package

Every adapter here is a few hundred bytes over the same core: it turns a runtime's request and response into one `track()` call. Splitting them into separately published packages would multiply versions to keep in lockstep for no size benefit, since subpath exports already mean you load only the adapter you import. One package, one version, one changelog, with `@revu-ai/server/<runtime>` for the adapters. The source ships as plain ESM from `src/` (no build step to debug through), with generated `.d.ts` types in `dist/types`.

## Size

Each entry point bundled on its own and minified, as an edge bundle would include it:

| Entry | Minified | Gzipped | Budget (min / gzip) |
| --- | --- | --- | --- |
| `@revu-ai/server` (core) | 12.76 kB | 5.36 kB | 13 kB / 5.5 kB |
| `/cloudflare` (includes the core) | 13.56 kB | 5.60 kB | 13.8 kB / 5.7 kB |
| `/node`, `/fastify`, `/fetch`, `/bun`, `/deno`, `/next` | 0.5 to 1.2 kB | 0.35 to 0.71 kB | 1.5 kB / 0.8 kB each |

`bun run size` enforces the budgets.

## Versioning

`@revu-ai/server` follows semver. Patch releases fix internals. Minor releases add options or adapters. Breaking changes are reserved for majors and are deprecated for at least one minor release first. The public surface is `createRevuServer`, the reporter's three methods, the adapter exports, the exported helpers and types. Everything else under `src/` is internal. The wire format evolves additively.

## Development

Vanilla JavaScript (ESM) with JSDoc. Types are generated, never hand-written.

```bash
bun install
```

```bash
bun run check
```

`check` runs lint, format check, type generation check, tests and the size gate. `bun test` alone runs the tests (fake `fetch` and loopback servers, no network). `node scripts/smoke.js`, `bun scripts/smoke.js` and `deno run scripts/smoke.js` run the same smoke test on each runtime.

CI (`.github/workflows/ci.yml`) runs `check` and the Bun smoke test on every push to `main` and every pull request, and the smoke test on Node 20, 22 and 24 and Deno. Publishing to npm is automated from a GitHub Release (`.github/workflows/release.yml`).

## License

Apache-2.0. See [LICENSE](./LICENSE).
