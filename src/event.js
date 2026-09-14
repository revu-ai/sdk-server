/**
 * @file Builds the `$crawl` event for one request, applying the privacy rules
 * at the source: only host, path (query and path parameters stripped unless
 * allowlisted), method, status, user agent, client IP, referer host and
 * timestamp leave the customer's server. Bodies, cookies and every other
 * header are never read.
 */

import { isPageRequest, looksAutomated } from "./filter.js";
import { resolveClientIp } from "./ip.js";
import { getHeader, truncate, uuid } from "./utils.js";

/** Length caps that keep a single event small and bounded. */
const MAX_HOST = 255;
const MAX_PATH = 1024;
const MAX_USER_AGENT = 512;

/** Absolute URL (`scheme://...`), as opposed to an origin-form path. */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Drop path parameters (everything from the first semicolon), such as a
 * `jsessionid=...` suffix, which some servers use to carry session ids in
 * the path.
 * @param {string} path
 * @returns {string}
 */
function stripPathParams(path) {
  const semi = path.indexOf(";");
  return semi === -1 ? path : path.slice(0, semi) || "/";
}

/**
 * Split a request target into host, path and raw query. Origin-form targets
 * (`/a/b?c`) are split by hand rather than with `new URL`, because a target
 * such as `//evil.example/x` would otherwise be parsed as a host. Path
 * parameters are removed from the path.
 *
 * @param {string} url
 * @returns {{ host: string, path: string, query: string }}
 */
export function parseTarget(url) {
  const target = typeof url === "string" ? url : "";
  if (ABSOLUTE_URL.test(target)) {
    try {
      const parsed = new URL(target);
      return {
        host: parsed.host,
        path: stripPathParams(parsed.pathname || "/"),
        query: parsed.search.slice(1),
      };
    } catch {}
  }
  const noFragment = target.split("#", 1)[0] ?? "";
  const q = noFragment.indexOf("?");
  const path = stripPathParams(q === -1 ? noFragment : noFragment.slice(0, q));
  return {
    host: "",
    path: path.startsWith("/") ? path : `/${path}`,
    query: q === -1 ? "" : noFragment.slice(q + 1),
  };
}

/**
 * Keep only allowlisted query parameters, in their original order.
 * @param {string} query Raw query string without the leading `?`.
 * @param {ReadonlySet<string>} allowlist
 * @returns {string} The filtered query, or `""`.
 */
function filterQuery(query, allowlist) {
  if (!query || allowlist.size === 0) return "";
  try {
    const kept = new URLSearchParams();
    for (const [key, value] of new URLSearchParams(query)) {
      if (allowlist.has(key)) kept.append(key, value);
    }
    return kept.toString();
  } catch {
    return "";
  }
}

/**
 * Hostname of a `Referer` header, or `null`. The full referring URL is never
 * sent, since its path and query can carry personal data.
 * @param {string | undefined} referer
 * @returns {string | null}
 */
function refererHost(referer) {
  if (!referer) return null;
  try {
    return new URL(referer).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * ISO timestamp for the request, defaulting to now.
 * @param {Date | number | string | undefined} value
 * @returns {string}
 */
function toIso(value) {
  if (value != null) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

/**
 * The host the client asked for, from `X-Forwarded-Host`, read only behind a
 * trusted proxy (`trustProxy`). A reverse proxy often passes its upstream
 * name (`127.0.0.1:3000`) as `Host`, which REVU cannot match to a touchpoint
 * domain. The first entry is the original host.
 *
 * @param {import("./types.js").RequestInfo["headers"]} headers
 * @param {import("./config.js").ResolvedConfig} config
 * @returns {string | null} `null` when untrusted or absent.
 */
function forwardedHost(headers, config) {
  if (!config.trustProxy) return null;
  const value = getHeader(headers, "x-forwarded-host");
  const first = value ? (value.split(",", 1)[0] ?? "").trim() : "";
  return first || null;
}

/**
 * Apply the pre-filter and, when the request qualifies, build its event.
 *
 * @param {import("./types.js").RequestInfo} request
 * @param {import("./config.js").ResolvedConfig} config
 * @returns {import("./types.js").CrawlEvent | null} `null` when the request is not reportable.
 */
export function toCrawlEvent(request, config) {
  const method = String(request.method || "GET").toUpperCase();
  const target = parseTarget(request.url);

  const page = isPageRequest(
    { method, path: target.path, contentType: request.contentType, status: request.status },
    { ignorePaths: config.ignorePaths },
  );
  if (!page) return null;

  const userAgent = getHeader(request.headers, "user-agent") ?? "";
  if (!looksAutomated(userAgent)) return null;

  const query = filterQuery(target.query, config.queryAllowlist);
  const host =
    forwardedHost(request.headers, config) ??
    getHeader(request.headers, "host") ??
    getHeader(request.headers, ":authority") ??
    target.host;
  const status =
    typeof request.status === "number" &&
    Number.isInteger(request.status) &&
    request.status >= 100 &&
    request.status <= 599
      ? request.status
      : null;

  return {
    event_type: "$crawl",
    event_id: uuid(),
    timestamp: toIso(request.timestamp),
    host: truncate(host.trim().toLowerCase(), MAX_HOST),
    path: truncate(query ? `${target.path}?${query}` : target.path, MAX_PATH),
    method,
    status,
    user_agent: truncate(userAgent, MAX_USER_AGENT),
    ip: resolveClientIp(request, config),
    referer_host: refererHost(getHeader(request.headers, "referer")),
  };
}
