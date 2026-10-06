/**
 * @file The client-side pre-filter. Two cheap checks decide whether a request
 * is worth reporting at all:
 *
 * 1. {@link isPageRequest}: a page-like GET or HEAD (an HTML document, or one
 *    of the files crawlers read to learn about a site: `robots.txt`,
 *    `llms.txt`, sitemaps). Assets and API calls are ignored, unless the
 *    caller lists their paths in `reportPaths`.
 * 2. {@link looksAutomated}: the user agent looks like a crawler, a fetcher or
 *    a scripted HTTP client rather than a person's browser.
 *
 * Both are deliberately generous. The REVU API re-classifies every hit and
 * discards the ones it decides are human, so over-including here is safe. The
 * goal is only that ordinary browser traffic is never sent. Both run in well
 * under a microsecond per request (a couple of regex tests, no allocation
 * beyond the path split).
 */

/** Files crawlers fetch to learn about a site, reported regardless of content type. */
const CRAWLER_FILE = /^\/(?:robots\.txt|llms(?:-full)?\.txt)$|\/[^/]*sitemap[^/]*\.xml(?:\.gz)?$/i;

/**
 * Known static asset and data file extensions, tested against the last path
 * segment. These are never pages. A denylist rather than an allowlist of page
 * extensions, so page paths that merely contain a dot (`/user/john.doe`,
 * `/docs/v1.2`) are still reported. A plain regex literal, so bundles that
 * only import `looksAutomated` drop it entirely.
 */
const ASSET_EXTENSION =
  /\.(?:js|mjs|cjs|map|css|json|jsonld|webmanifest|xml|rss|atom|txt|csv|tsv|png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|heic|woff2?|ttf|otf|eot|mp[34]|m4[av]|webm|og[agv]|wav|flac|mov|avi|mkv|pdf|zip|t?gz|tar|rar|7z|bz2|xz|dmg|exe|msi|apk|wasm|bin)$/i;

/** Response content types that denote an HTML document. */
const HTML_CONTENT_TYPE = /^\s*(?:text\/html|application\/xhtml\+xml)\b/i;

/**
 * Paths that are never pages: API routes, framework internals and the health
 * endpoints that load balancers and orchestrators poll every few seconds.
 * Health paths match exactly (with an optional trailing slash), so a page such
 * as `/healthcare` still counts.
 */
const BUILT_IN_IGNORES = [
  /^\/api(?:\/|$)/i,
  /^\/graphql(?:\/|$)/i,
  /^\/_next\//,
  /^\/(?:health|healthz|livez|readyz|ping)\/?$/i,
];

/**
 * Health-check probes from orchestrators and load balancers (Kubernetes, AWS
 * load balancers, Google Cloud load balancers, Consul, Envoy). They poll a
 * page every few seconds and are never crawlers, so they are never reported.
 */
const HEALTH_PROBE = /kube-probe|ELB-HealthChecker|GoogleHC|Consul Health Check|Envoy\/HC/i;

/**
 * User-agent tokens that mark automated clients. Covers the generic
 * bot / crawler / spider family, link-preview fetchers, AI crawler and AI
 * assistant fetchers that do not use the generic words (every AI crawler the
 * REVU API counts as an AI agent is matched, even without a contact URL),
 * headless browsers and audit tools, and the `+http://...` contact URL that
 * crawlers embed. The `(?<!cu)` guard keeps one phone model name out of the
 * `bot` match.
 */
const AUTOMATED_TOKENS =
  /(?<!cu)bot|crawl|spider|slurp|scrap|fetch|archiv|preview|externalhit|externalagent|whatsapp|chatgpt|claude|anthropic|perplexity|cohere|mistral|google-|-google|googleother|headless|lighthouse|phantomjs|\+https?:\/\/|amazon-|amzn-|amazonbuy|aiwebindex|autorag|awario|bigsur\.ai|cotoyogi|gemini-|googleagent|img2dataset|kimi-|laion|manus-|notebooklm|novaact|panscient|poggio|qodercli|shap-|tabstack|webindexer|webzio|yandexadditional/i;

/**
 * Does a browser-like user agent contradict itself? True only for
 * combinations no shipped browser sends, which means a client wrote the
 * string by hand. Each rule rests on a browser vendor's own convention:
 *
 * 1. The legacy `Edge/` token next to `Chrome/79` or later. Chromium-based
 *    Edge identifies as `Edg/`, `EdgA/` or `EdgiOS/`, and the older engine
 *    behind `Edge/` shipped beside Chrome 64 at the newest.
 * 2. An iOS hardware model in the platform slot, the first parenthesis after
 *    `Mozilla/5.0`, as in `(iPhone13,2;`. iOS puts only the platform there
 *    (`iPhone`, `iPad`, `iPod`). In-app browsers that append the model later
 *    in the string are real browsers, so only that slot is checked.
 *
 * The REVU API applies the same two rules and counts a match as a bot, so
 * a match has to be sent or the hit is lost.
 *
 * @param {string} ua
 * @returns {boolean}
 */
function contradictsItself(ua) {
  const chrome = /[\s;(]Chrome\/(\d+)/.exec(ua);
  if (chrome && Number(chrome[1]) >= 79 && /[\s;(]Edge\/\d/.test(ua)) return true;
  return /^Mozilla\/5\.0 \((?:iPhone|iPad|iPod)\d+,\d+\s*[;)]/.test(ua);
}

/**
 * Does this user agent look automated?
 *
 * True for any user agent that does not start with `Mozilla/` (every
 * mainstream browser does, while scripted HTTP clients such as command-line
 * tools and language HTTP libraries do not), for browser-like user agents
 * that carry a crawler token, and for browser-like user agents that
 * contradict themselves (see {@link contradictsItself}). False for an empty
 * user agent (the REVU API classifies each hit by its user agent and rejects
 * a hit without one) and for health-check probes, which poll constantly and
 * are never crawlers.
 *
 * @param {string | null | undefined} userAgent
 * @returns {boolean}
 */
export function looksAutomated(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent.trim() : "";
  if (!ua || HEALTH_PROBE.test(ua)) return false;
  if (!/^mozilla\//i.test(ua)) return true;
  return AUTOMATED_TOKENS.test(ua) || contradictsItself(ua);
}

/**
 * Does `path` match one of the rules, each a path prefix or a regular expression?
 * @param {string} path Path without query string.
 * @param {ReadonlyArray<string | RegExp>} rules
 * @returns {boolean}
 */
function matchesAny(path, rules) {
  for (const rule of rules) {
    if (typeof rule === "string" ? path.startsWith(rule) : rule.test(path)) return true;
  }
  return false;
}

/**
 * Is this a page-like request worth reporting?
 *
 * - The method must be GET or HEAD.
 * - `robots.txt`, `llms.txt`, `llms-full.txt` and sitemap files always count.
 * - `ignorePaths` never count.
 * - `reportPaths` always count, whatever their extension or content type, even
 *   under a built-in ignore. This is how an API is reported.
 * - Built-in ignores (`/api`, `/graphql`, `/_next/`, health endpoints such as
 *   `/healthz`) never count.
 * - A path whose last segment has a known asset extension (`.js`, `.png`, `.json`, ...) never counts.
 * - A redirect (3xx status) counts whatever its content type, since frameworks
 *   often answer redirects with a plain-text body.
 * - Otherwise, when the response content type is known, it must be HTML.
 *
 * @param {{ method?: string | null, path?: string | null, contentType?: string | null, status?: number | null }} request
 * @param {{ ignorePaths?: ReadonlyArray<string | RegExp>, reportPaths?: ReadonlyArray<string | RegExp> }} [options]
 * @returns {boolean}
 */
export function isPageRequest(request, options) {
  const method = String(request.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;

  const raw = typeof request.path === "string" && request.path ? request.path : "/";
  const path = raw.split(/[?#]/, 1)[0] || "/";

  if (CRAWLER_FILE.test(path)) return true;
  if (matchesAny(path, options?.ignorePaths ?? [])) return false;
  if (matchesAny(path, options?.reportPaths ?? [])) return true;
  if (matchesAny(path, BUILT_IN_IGNORES)) return false;

  if (ASSET_EXTENSION.test(path.slice(path.lastIndexOf("/") + 1))) return false;

  const status = request.status;
  if (typeof status === "number" && status >= 300 && status < 400) return true;

  const contentType = request.contentType;
  if (typeof contentType === "string" && contentType.trim()) {
    return HTML_CONTENT_TYPE.test(contentType);
  }
  return true;
}
