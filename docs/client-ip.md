# Client IP and proxies

REVU verifies every reported crawler by the address it connected from: an address in the vendor's published list, or a reverse DNS name the vendor documents, confirmed by a forward lookup. So the SDK must report the address the crawler connected from, not your proxy's. Forwarding headers can be forged by any client, so they are read only when you say a proxy you control sets them.

## Pick your setting

| Your setup | Setting |
| --- | --- |
| Server receives connections directly | default (`trustProxy: false`) |
| One reverse proxy or load balancer in front | `trustProxy: 1` |
| Two proxies in front (for example a CDN, then a load balancer) | `trustProxy: 2` |
| Your edge sets a single trusted client IP header | `trustProxy: true, ipHeader: "<header name>"` |
| Cloudflare in front of your origin (proxied DNS) | `trustProxy: true, ipHeader: "cf-connecting-ip"` (only when your origin accepts traffic from Cloudflare alone, otherwise a client can set that header) |
| Cloudflare Workers adapter | nothing: `CF-Connecting-IP` is used automatically |
| Platform that sets `X-Forwarded-For` itself | `trustProxy: 1` (check your platform's documentation for how it sets the header) |

For example, behind one load balancer:

```js
const revu = createRevuServer({
  serverKey: process.env.REVU_SERVER_KEY,
  trustProxy: 1,
});
```

## What a wrong setting looks like

- **Your proxy's address is reported** (a proxy in front, but no `trustProxy` or `ipHeader`). When that proxy is a CDN edge (Cloudflare, Fastly or Akamai), REVU recognizes the address and leaves the hits unverifiable: your crawlers still count, but none can be verified. Any other proxy address fails verification, so REVU shows your real GPTBot or Googlebot hits as spoofed and leaves them out of AI visibility.
- **A client-controlled address is reported** (`trustProxy: true` behind an edge that appends to `X-Forwarded-For`). A scraper can put a real crawler's address in the header and pass verification.

Set a hop count that matches the number of proxies you run, or `ipHeader` for the single header your edge sets.

## How each setting reads the address

- **`trustProxy: false`** (the default) uses the socket address and never reads a forwarding header.
- **A hop count** takes the address from the right of `X-Forwarded-For`, where only your own proxies write. With `trustProxy: 2`, the second entry from the right is used.
- **`trustProxy: true`** takes the leftmost `X-Forwarded-For` entry. It is only safe when your edge replaces, rather than appends to, the header clients send. Use it as a last resort: prefer a hop count or `ipHeader`, since a spoofed address defeats crawler verification. With `debug` on, the SDK warns once when `true` is used without `ipHeader`.
- **`ipHeader`** reads one single-value header set by your edge (`cf-connecting-ip`, `x-real-ip`, ...) and never reads `X-Forwarded-For`. A request that arrives without that header (one that bypassed your edge) is attributed to its socket address.

String values are accepted too (`"true"`, `"false"`, `"2"`), so the setting can be read straight from an environment variable.

## The reported host

REVU matches each hit to your touchpoint by its host. A reverse proxy often passes its upstream name (`127.0.0.1:3000`, `localhost`) as `Host`, which matches none of your domains, so REVU refuses the hit. With `trustProxy` on, the reported host comes from `X-Forwarded-Host` (its first entry) when present, so the hit carries the host the crawler asked for. Without a trusted proxy, `X-Forwarded-Host` is never read.

## Validation

Every address is validated before it is sent. A forwarded value that is not a well-formed IPv4 or IPv6 address is ignored and the socket address is used instead. When no valid address is available at all, the hit is sent with `ip: null` rather than a malformed value.

## Checking the result

If REVU shows your proxy's address for every hit, lists your real crawlers as spoofed, or never verifies any of them, `trustProxy` is off or set too low. If it shows addresses you do not recognize, a hop count may be set too high, or `trustProxy: true` may be reading a header clients control. See [Troubleshooting](./troubleshooting.md#every-hit-shows-the-same-ip).
