# What is reported

Only crawler page hits are sent. Assets, API calls and ordinary browser traffic never leave your server, so reporting stays tiny even on a busy site.

## The rules

A request is reported only when all of these hold:

1. **Method** is GET or HEAD.
2. **Path** is page-like: an HTML document, or `robots.txt`, `llms.txt`, `llms-full.txt` or a sitemap file (`*sitemap*.xml`, `.xml.gz`). Paths whose last segment has a known asset extension (`.js`, `.css`, `.png`, `.json`, `.pdf`, ...) are skipped, while paths that merely contain a dot (`/user/john.doe`) still count. `/api`, `/graphql`, `/_next/`, health endpoints (`/health`, `/healthz`, `/livez`, `/readyz`, `/ping`) and your `ignorePaths` are skipped.
3. **Response** is HTML, when the content type is known. Crawler files and redirects (3xx) count whatever their content type.
4. **User agent looks automated**: not starting with `Mozilla/` (command-line tools and HTTP libraries), or carrying a crawler token (bot, crawler, spider, preview and fetcher names, headless browsers, a `+http` contact URL), or a browser user agent that contradicts itself in a way no shipped browser does (the legacy `Edge/` token beside Chrome 79 or later, an iOS hardware model such as `iPhone13,2` where iOS puts the platform, or a Safari `Version/` newer than the iOS carrying it). Requests without a user agent are not reported, since REVU classifies each hit by it. Health-check probes (`kube-probe`, `ELB-HealthChecker`, `GoogleHC`, `Consul Health Check`, `Envoy/HC`) are never reported.

## Examples

| Request | Reported | Why |
| --- | --- | --- |
| `GET /pricing` from `curl/8.7.1`, HTML | yes | a scripted client fetching a page |
| `GET /pricing` from a crawler with a `+https://...` contact URL | yes | a crawler token in a browser-like user agent |
| `GET /pricing` from a Safari user agent newer than its iOS | yes | a browser user agent no browser sends |
| `GET /robots.txt` from a crawler, plain text | yes | crawler files count whatever their content type |
| `GET /old-page` answered with a `301` | yes | redirects count whatever their content type |
| `GET /pricing` from a desktop browser | no | ordinary browser traffic |
| `GET /app.js` from a crawler | no | a static asset |
| `GET /api/users` from a crawler | no | a built-in ignore |
| `POST /contact` from a crawler | no | not GET or HEAD |
| `GET /` from `kube-probe/1.29` | no | a health-check probe |
| `GET /healthz` from a monitor | no | a health endpoint |
| `GET /pricing` with no user agent | no | REVU cannot classify it |

## A pre-filter, not the verdict

Rule 4 is a cheap pre-filter. It is generous on purpose, and its only guarantee is that ordinary browser traffic is never sent. REVU re-classifies every hit it receives and drops the ones it does not recognize as automated, so a hit that passes the pre-filter is not necessarily stored.

## Skipping your own paths

Add prefixes or regular expressions to `ignorePaths` for pages that should never be reported, such as an admin area or preview routes:

```js
const revu = createRevuServer({
  serverKey: process.env.REVU_SERVER_KEY,
  ignorePaths: ["/admin", /^\/preview\//],
});
```

The built-in ignores (`/api`, `/graphql`, `/_next/` and the health endpoints `/health`, `/healthz`, `/livez`, `/readyz`, `/ping`) always apply.

For a rule the path cannot express, such as a staff header, a preview host or a known internal address, add `shouldReport`. It runs last, only for hits that would otherwise be sent, and gets the same request `track()` got. Return `false` to drop the hit:

```js
const revu = createRevuServer({
  serverKey: process.env.REVU_SERVER_KEY,
  shouldReport: (request) => request.remoteAddress !== "10.0.0.5", // your own monitor
});
```

Keep it synchronous and cheap, since it runs on the request path. A check that throws drops the hit. For skipping requests that bypassed your CDN, see [Requests that bypass your edge](./client-ip.md#requests-that-bypass-your-edge).
