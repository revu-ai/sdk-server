# Setup by runtime

Every adapter is a subpath of the same package and uses the same reporter. Create one reporter per process, then pick the adapter for your runtime. All policy (filtering, privacy, batching) lives in the core, so every runtime reports the same way.

| Runtime or framework | Import |
| --- | --- |
| Express, Connect, `node:http` | `@revu-ai/server/node` |
| Fastify | `@revu-ai/server/fastify` |
| Next.js middleware | `@revu-ai/server/next` |
| Bun (`Bun.serve`) | `@revu-ai/server/bun` |
| Deno (`Deno.serve`) | `@revu-ai/server/deno` |
| Cloudflare Workers | `@revu-ai/server/cloudflare` |
| Any fetch-style handler | `@revu-ai/server/fetch` |

## Express, Connect, node:http

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
import { createRevuServer } from "@revu-ai/server";
import { revuMiddleware } from "@revu-ai/server/node";

const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
const track = revuMiddleware(revu);

http.createServer((req, res) => {
  track(req, res); // no next(): it only observes
  handle(req, res); // your handler
});
```

The hit is recorded on the response `finish` event, so the status and content type are final.

## Fastify

```js
import Fastify from "fastify";
import { createRevuServer } from "@revu-ai/server";
import { fastifyRevu } from "@revu-ai/server/fastify";

const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
const app = Fastify();
await app.register(fastifyRevu(revu)); // applies to every route
app.addHook("onClose", () => revu.shutdown());
```

## Next.js (middleware)

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

Middleware runs before the page renders, so the final status is only known when your middleware answers itself (a redirect or a direct response). When it lets the request continue, the hit is sent with `status: null`. The send is handed to `event.waitUntil`. Set `trustProxy` to match your hosting, see [Client IP and proxies](./client-ip.md).

REVU counts a hit without a status as coverage, so a page that passes through middleware and then renders a 404 still counts as crawled. When exact statuses matter, report from the server that renders the pages instead, for example a custom Node server with `@revu-ai/server/node`.

## Bun

```js
import { createRevuServer } from "@revu-ai/server";
import { withRevu } from "@revu-ai/server/bun";

const revu = createRevuServer({ serverKey: Bun.env.REVU_SERVER_KEY });

Bun.serve({
  fetch: withRevu(revu, (request, server) => new Response("hello")),
});
```

The client address comes from `server.requestIP()`.

## Deno

```js
import { createRevuServer } from "npm:@revu-ai/server";
import { withRevu } from "npm:@revu-ai/server/deno";

const revu = createRevuServer({ serverKey: Deno.env.get("REVU_SERVER_KEY") });

Deno.serve(withRevu(revu, (request, info) => new Response("hello")));
```

The client address comes from `info.remoteAddr`.

## Cloudflare Workers

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

## Any fetch-style handler

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

When `getWaitUntil` returns a function, each reported hit is flushed through it after the response. Otherwise the reporter's timer sends it.

## Calling track() yourself

For a server or framework without an adapter, call `track()` once per finished request:

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

## Serverless functions without waitUntil

Platforms that freeze a function once it returns and offer no `waitUntil` (AWS Lambda style) never let the flush timer run, so queued hits would be lost. Call `await revu.flush()` before the function returns:

```js
import { createRevuServer } from "@revu-ai/server";

const revu = createRevuServer({
  serverKey: process.env.REVU_SERVER_KEY,
  flushIntervalMs: 0,
  minSendIntervalMs: 0, // never wait for the previous send
  timeoutMs: 1000, // how long one send may take
  retryDelayMs: 0, // retry a failed send at once rather than holding the invocation
});

export async function handler(event) {
  const response = await render(event); // your function
  revu.track(requestInfo); // the request, as in "Calling track() yourself"
  await revu.flush();
  return response;
}
```

The flush returns at once when nothing was queued, so only invocations that served a crawler wait for the send. That wait is at most `timeoutMs`, or twice `timeoutMs` plus `retryDelayMs` when the first attempt fails and is retried (2 s with the settings above).

## Shutting down

On a natural exit, Node and Bun flush once automatically (`beforeExit`). That final flush makes one attempt with no retry, so exit waits at most `timeoutMs` for an unresponsive endpoint. Signals are left to you, so add the flush to your own handler:

```js
process.on("SIGTERM", async () => {
  await revu.shutdown(); // bounded by shutdownTimeoutMs
  process.exit(0);
});
```

Edge runtimes (Cloudflare Workers, Next.js middleware, any handler with `waitUntil`) need no shutdown step, since each hit is flushed after its own response.
