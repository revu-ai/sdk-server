# Install

Add the package, create one reporter with your secret server key, and attach it to your server. This page ends with a quick check that hits are being sent.

## Requirements

- Node 20 or later, Bun, Deno, Cloudflare Workers or Next.js middleware. Any other stack can use [plain HTTP](./plain-http.md).
- A REVU website touchpoint and a **secret server key** for each environment you report from (`revu_sk_prod_...`, `revu_sk_stg_...`, `revu_sk_dev_...`).

## Add the package

```bash
npm install @revu-ai/server
```

```bash
bun add @revu-ai/server
```

On Deno, import it with the `npm:` specifier (`npm:@revu-ai/server`). The package has no runtime dependencies.

## Your server key

The server key is a secret. Keep it in an environment variable or a secret store, never in client code or source control. It is not the public browser key (`revu_pk_...`) used by the web SDK. A public key is refused and the reporter stays disabled.

Each key belongs to one environment (production, staging or development) and carries it in its prefix: `revu_sk_prod_...`, `revu_sk_stg_...` or `revu_sk_dev_...`. Create one key per environment and deploy each environment with its own key, for example by setting `REVU_SERVER_KEY` per deploy.

Create keys in REVU: open your website's touchpoint (Settings > Touchpoints), pick the environment's tab and use its **Server capture** card. A staging key needs the touchpoint's staging domain to be set first. The key is shown once, so store it right away. Organization owners and admins can create and revoke keys. Each environment can have up to 5 active keys, so you can rotate one without a gap: create the new key, deploy it, then revoke the old one.

A missing or malformed key never throws. The reporter is created disabled and does nothing, and the reason is logged when `debug` is on.

## Your touchpoint's domains

Each key accepts only the hosts of its own environment: the domain set for that environment on the touchpoint, and its subdomains. When domains overlap, the most specific one decides, so `staging.example.com` is staging even when production is `example.com`. The development key also accepts `localhost`. A port is ignored. Hits for any other host are dropped, so a production key refuses `localhost`.

## Attach it

Create one reporter per process and register the adapter for your runtime. For Express:

```js
import express from "express";
import { createRevuServer } from "@revu-ai/server";
import { revuMiddleware } from "@revu-ai/server/node";

const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });

const app = express();
app.use(revuMiddleware(revu)); // register first so every route is seen
```

Every other runtime is covered in [Setup by runtime](./runtimes.md). If your server sits behind a proxy or load balancer, also set `trustProxy`, see [Client IP and proxies](./client-ip.md).

## Check that it works

Turn on `debug` while you try it, and use your development key, since a production key refuses `localhost`:

```js
const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY, debug: true });
```

Then request a page the way a crawler would. A user agent that does not start with `Mozilla/` is treated as automated:

```bash
curl -A "ExampleBot/1.0" http://localhost:3000/
```

Within the flush interval (5 s by default) the SDK logs the send and what REVU did with each hit to `console.warn`:

```
[revu/server] sent 1 hit(s): 1 accepted, 0 duplicate(s), 0 rejected
```

A browser visit to the same page logs nothing, since browser traffic is never sent. If the hit is rejected, or nothing is logged, see [Troubleshooting](./troubleshooting.md). The touchpoint's Server capture card in REVU shows the same picture: hits received per environment, and the reason for any rejection.

Turn `debug` off again for production. The SDK is silent otherwise.
