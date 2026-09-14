/**
 * @file Client IP resolution. The real connecting IP is what lets the REVU API
 * verify a crawler (reverse DNS, published address ranges), so it has to be
 * right and it has to be hard to spoof.
 *
 * Forwarding headers (`X-Forwarded-For`, or a single-value header such as
 * `CF-Connecting-IP`) are attacker-controlled unless a proxy you operate sets
 * them. They are therefore read only when the operator opts in with
 * `trustProxy`. Otherwise the connecting socket address is used.
 */

import { getHeader } from "./utils.js";

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV4_WITH_PORT = /^((?:\d{1,3}\.){3}\d{1,3}):\d+$/;
const IPV6 = /^[0-9a-f:.]+$/i;
const BRACKETED = /^\[([^\]]+)\](?::\d+)?$/;

/**
 * @param {string} ip
 * @returns {boolean} A dotted quad with every octet in 0-255.
 */
function isIpv4(ip) {
  return IPV4.test(ip) && ip.split(".").every((octet) => Number(octet) <= 255);
}

/**
 * Cheap IPv6 plausibility check: hex groups and colons only, at least two
 * colons, at least one hex digit, at most one `::`, and an embedded IPv4
 * tail (if any) that is itself valid. Not a full RFC 4291 parser, just enough
 * to reject garbage such as `:` or `::`.
 * @param {string} ip
 * @returns {boolean}
 */
function isIpv6(ip) {
  if (!IPV6.test(ip) || ip.split(":").length < 3 || !/[0-9a-f]/i.test(ip)) return false;
  if (ip.indexOf("::") !== ip.lastIndexOf("::")) return false;
  const tail = ip.slice(ip.lastIndexOf(":") + 1);
  return tail.includes(".") ? isIpv4(tail) : /^[0-9a-f]{0,4}$/i.test(tail);
}

/**
 * Normalize one address: trim, drop quotes, brackets, ports and IPv6 zone ids,
 * and unwrap IPv4-mapped IPv6 (`::ffff:1.2.3.4` becomes `1.2.3.4`). Returns
 * `null` for anything that is not a plausible IPv4 or IPv6 literal (for
 * example `unknown` or an obfuscated `Forwarded` identifier).
 *
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function normalizeIp(value) {
  if (typeof value !== "string") return null;
  let ip = value.trim().replace(/^"|"$/g, "");
  if (!ip) return null;

  const bracketed = BRACKETED.exec(ip);
  if (bracketed) ip = String(bracketed[1]);
  const withPort = IPV4_WITH_PORT.exec(ip);
  if (withPort) ip = String(withPort[1]);
  ip = ip.split("%", 1)[0] ?? "";

  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:") && isIpv4(ip.slice(7))) return ip.slice(7);
  if (isIpv4(ip)) return ip;
  if (isIpv6(ip)) return lower;
  return null;
}

/**
 * @typedef {object} IpTrust
 * @property {boolean | number} trustProxy See `RevuServerOptions.trustProxy`.
 * @property {string | null} [ipHeader] See `RevuServerOptions.ipHeader`.
 */

/**
 * Resolve the client IP of a request.
 *
 * - `trustProxy: false` (default): the connecting address only.
 * - `ipHeader` set and trusted: that header's value, when it holds a valid IP.
 *   When the header is missing or invalid, the connecting address is used,
 *   never `X-Forwarded-For`, because a request that did not pass through
 *   the edge that sets `ipHeader` may carry a forged `X-Forwarded-For`.
 * - `trustProxy: n`: the `n`th `X-Forwarded-For` entry from the right (each
 *   trusted proxy appends the address it received the request from, so
 *   skipping `n - 1` entries lands on the address the outermost trusted
 *   proxy saw). Shorter lists fall back to the leftmost entry.
 * - `trustProxy: true`: the leftmost `X-Forwarded-For` entry.
 * - Anything unusable falls back to the connecting address.
 *
 * @param {{ headers?: import("./utils.js").HeadersLike | null, remoteAddress?: string | null }} request
 * @param {IpTrust} trust
 * @returns {string | null}
 */
export function resolveClientIp(request, trust) {
  const socketIp = normalizeIp(request.remoteAddress);
  if (!trust.trustProxy) return socketIp;

  if (trust.ipHeader) {
    const value = getHeader(request.headers, trust.ipHeader);
    return normalizeIp(value ? value.split(",", 1)[0] : null) ?? socketIp;
  }

  const forwarded = getHeader(request.headers, "x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (hops.length) {
      const index = trust.trustProxy === true ? 0 : Math.max(0, hops.length - trust.trustProxy);
      const ip = normalizeIp(hops[index]);
      if (ip) return ip;
    }
  }

  return socketIp;
}
