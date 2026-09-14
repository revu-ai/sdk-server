# Privacy and data

The privacy rules are applied on your server, before anything is queued. What leaves your server is one small event per reported request: eight fields about the request, plus the event type and a random event id.

## The event

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

`event_id` is a random UUID and `timestamp` is the time of the request. `status` is `null` when the adapter cannot see the final status (Next.js middleware that lets the request continue).

## What is reduced at the source

- **Host** is the `Host` header, or `X-Forwarded-Host` behind a trusted proxy. See [Client IP and proxies](./client-ip.md#the-reported-host).
- **Path** has its query string removed unless a parameter is in `queryAllowlist`. Path parameters (everything from the first semicolon in the path, such as a `jsessionid=...` session id) and fragments are never sent.
- **Referer** is reduced to its hostname. The referring URL's path and query are never sent.
- **Lengths are capped**: host 255, path 1024, user agent 512 characters.
- **Client IP** is taken from the socket unless you declare a trusted proxy, and is validated before it is sent. See [Client IP and proxies](./client-ip.md).

To keep a query parameter that matters for your pages, such as pagination, allowlist it by name:

```js
const revu = createRevuServer({
  serverKey: process.env.REVU_SERVER_KEY,
  queryAllowlist: ["page"],
});
```

## What is never read or sent

- Request and response bodies.
- Cookies and the `Authorization` header.
- Every header other than `Host`, `User-Agent`, `Referer` and, when trusted, the forwarding headers.
- Anything about ordinary browser visits. Browser traffic is filtered out before an event is built.

## What REVU keeps

REVU re-classifies every hit. Hits it does not recognize as automated are dropped, and their IP is not stored. The client IP of a crawler hit is used to verify the crawler: it is checked against the vendor's published address list, or by a reverse DNS lookup confirmed by a forward lookup. Nothing about your site, the page or your visitors is part of that check. The IP is cleared after 30 days, and the hit itself is kept. A hit from an address the vendor does not use is shown as spoofed and left out of AI visibility. An address on a CDN edge network (Cloudflare, Fastly or Akamai) cannot be the crawler's own, so such a hit is left unverifiable instead, and it still counts. The package talks only to REVU, never to any other service.
