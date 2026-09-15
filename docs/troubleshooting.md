# Troubleshooting

The SDK never throws into your server, so most problems show up as "no hits arrive" rather than as an error. Start by turning on `debug`, which logs every problem and every send to `console.warn`, prefixed with `[revu/server]`:

```js
const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY, debug: true });
```

## Nothing is logged at all

The reporter is not seeing requests that qualify.

1. **Confirm the adapter is registered before your routes.** With Express, `app.use(revuMiddleware(revu))` must come before the route handlers, or the requests never reach it. With `Bun.serve`, wrap `routes` with `withRevuRoutes` as well as `fetch` with `withRevu`. Bun answers a matched route without calling `fetch`, so wrapping `fetch` alone reports only unmatched paths, usually just your 404s. See [Bun](./runtimes.md#bun).
2. **Send a request that qualifies.** Browser visits are never reported. Use a crawler-like client and an HTML page, for example `curl -A "ExampleBot/1.0" http://localhost:3000/`. See [What is reported](./reporting.md).
3. **Check the response type.** A page answered with a non-HTML content type is skipped, unless it is a redirect or a crawler file (`robots.txt`, `llms.txt`, a sitemap).
4. **Check `ignorePaths`** and the built-in ignores (`/api`, `/graphql`, `/_next/` and the health endpoints `/health`, `/healthz`, `/livez`, `/readyz`, `/ping`).
5. **Wait for the flush.** Hits are sent every `flushIntervalMs` (5 s by default) or once `flushAt` hits are queued.

## The reporter is disabled

A problem with the options disables the reporter instead of throwing. The reason is logged once:

| Log line | Fix |
| --- | --- |
| `serverKey is missing. Reporting is disabled.` | The environment variable is not set in this process. |
| `serverKey is a public browser key (revu_pk_). Use the secret server key (revu_sk_). Reporting is disabled.` | Use the secret server key, not the web SDK's public key. |
| `serverKey must start with revu_sk_. Reporting is disabled.` | The value is not a server key (often a truncated or quoted value). |
| `No fetch implementation is available. Reporting is disabled.` | The runtime has no global `fetch`. Pass one with the `fetch` option. |

## REVU rejected the server key

```
[revu/server] REVU rejected the server key (HTTP 401). Reporting is off until restart.
```

`401` means the key is unknown, malformed or public, or the key's environment is turned off on the touchpoint (turn it on in Settings > Touchpoints). `403` means the key was revoked, or its touchpoint is archived or is not a website. The reporter stops sending and drops its queue until the process restarts, so fix the key and restart.

A `403` also answers any request sent from a browser (one that carries an `Origin` header). The SDK never sends one, so this only affects [plain HTTP](./plain-http.md) code that ended up in client code. A key used in a browser is exposed to every visitor: revoke it and create a new one.

## Hits are sent but do not appear in REVU

A `2xx` means the batch was accepted, not that every hit was stored. REVU checks each hit on its own, and says what it did. With `debug` on, every send logs the counts:

```
[revu/server] sent 3 hit(s): 2 accepted, 0 duplicate(s), 1 rejected (unknown_host 1)
```

The touchpoint's Server capture card in REVU shows the same counts per key, with the reason and host of the last rejection. The usual causes:

- **The host belongs to another environment, or to none** (`unknown_host`). A key accepts only its own environment's domain and subdomains, and `localhost` for the development key. A production key sending `localhost`, or a staging key sending the production domain, is refused. Check that each deploy uses its own environment's key and that the touchpoint's domains cover the hosts your server answers on. The Server capture card names the refused host. This is the most common cause.
- **A proxy passes its upstream name as the host.** If the refused host is something like `127.0.0.1:3000` or `localhost`, your reverse proxy is not forwarding the real host. Set `trustProxy` so the SDK reports `X-Forwarded-Host`, see [The reported host](./client-ip.md#the-reported-host).
- **The environment filter hides them.** Hits belong to the key's environment, so hits sent with the development key do not show in a production view.
- **The user agent is not recognized as automated.** The SDK's pre-filter is generous, and REVU drops hits whose user agent matches no known crawler, bot or HTTP client. A custom client name such as `MyApp/1.0` is dropped this way (`not_crawler`).
- **The hit is too old** (`invalid`). A hit more than 7 days old, for example one queued through a long outage, is rejected.

See [REVU API contract](./api-contract.md#rules) for every rule.

## Real crawlers show as spoofed or are never verified

REVU verifies each crawler by the address the SDK reports. If AI visibility lists a real crawler such as GPTBot or Googlebot as spoofed (it came from addresses its vendor does not use), the SDK is reporting the wrong address, usually your proxy's. Behind a CDN edge (Cloudflare, Fastly or Akamai) the same mistake looks different: REVU recognizes the edge address and leaves the hits unverifiable, so your crawlers still count but none of them is ever verified. Behind a proxy or load balancer, set `trustProxy` to the number of proxies you run, or `ipHeader` to the header your edge sets. See [Client IP and proxies](./client-ip.md#what-a-wrong-setting-looks-like).

## Every hit shows the same IP

That is your proxy or load balancer's address. Behind a proxy, the socket address is the proxy, so set `trustProxy` to the number of proxies you run, or name the header your edge sets with `ipHeader`. See [Client IP and proxies](./client-ip.md).

## Other debug lines

| Log line | Meaning |
| --- | --- |
| `sent N hit(s): ...` | A batch was accepted. The rest of the line counts what REVU stored, already had and rejected, by reason. |
| `sending paused for N ms` | A send failed or was throttled. Sending resumes after the pause. |
| `dropped N hit(s): send failed twice` | REVU was unreachable or answered `5xx` twice. The batch is dropped and sending backs off. |
| `dropped N hit(s): payload too large, batch size is now N` | The batch was over the API limit. Later batches are smaller. |
| `dropped N hit(s): rejected (HTTP N)` | REVU refused the batch as malformed. It is not retried. |
| `dropped N hit(s): queue full while throttled` | Hits arrived faster than REVU accepted them during a pause, and the oldest were dropped. |
| `internal error (ignored): ...` | An internal error was swallowed. Your server is unaffected. |

## Next.js hits have no status

Middleware runs before the page renders, so when it lets the request continue, the final status is unknown and the hit is sent with `status: null`. When your middleware answers itself (a redirect or a direct response), the status is reported.

## The process takes a moment to exit

On a natural exit, Node and Bun make one final send attempt, bounded by `timeoutMs` (3 s). An unreachable endpoint can hold the exit for at most that long. Lower `timeoutMs` or set `flushOnExit: false` to shorten it.
