/**
 * @file Next.js adapter: wraps (or provides) the app's middleware.
 *
 * Middleware runs before the page renders, so the final status is known only
 * when the middleware itself answers (a redirect or a direct `Response`).
 * When it lets the request continue (`NextResponse.next()`, a rewrite, or no
 * return value), the hit is reported with `status: null`. The flush is handed
 * to `event.waitUntil` so it runs after the middleware returns.
 *
 * `request.ip` is used as the client address when the platform provides it.
 * Otherwise set `trustProxy` (and optionally `ipHeader`) on the reporter to
 * match your hosting, see the README.
 */

import { safe } from "../utils.js";

/**
 * The parts of a `NextRequest` that are read.
 * @typedef {object} NextRequestLike
 * @property {string} method
 * @property {string} url
 * @property {Headers} headers
 * @property {string} [ip] Provided by some Next.js versions and platforms.
 */

/**
 * The parts of a `NextFetchEvent` that are used.
 * @typedef {object} NextFetchEventLike
 * @property {(promise: Promise<unknown>) => void} [waitUntil]
 */

/**
 * A Next.js middleware function.
 * @typedef {(request: any, event: any) => Response | null | undefined | void | Promise<Response | null | undefined | void>} NextMiddleware
 */

/**
 * Headers Next.js puts on a middleware response that lets routing continue,
 * which means the final status is not yet known.
 */
const CONTINUE_HEADERS = ["x-middleware-next", "x-middleware-rewrite"];

/**
 * Wrap a Next.js middleware. With no middleware, returns one that only reports.
 *
 * @example
 * // middleware.js
 * import { createRevuServer } from "@revu-ai/server";
 * import { withRevu } from "@revu-ai/server/next";
 *
 * const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY, trustProxy: 1 });
 *
 * export default withRevu(revu);
 *
 * export const config = {
 *   matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
 * };
 *
 * @param {import("../types.js").RevuServer} reporter
 * @param {NextMiddleware} [middleware]
 * @returns {(request: NextRequestLike, event: NextFetchEventLike) => Promise<Response | null | undefined | void>}
 */
export function withRevu(reporter, middleware) {
  const observe = safe(
    /**
     * @param {NextRequestLike} request
     * @param {NextFetchEventLike | undefined} event
     * @param {Response | null | undefined | void} response
     * @param {boolean} threw
     * @param {number} timestamp
     */
    (request, event, response, threw, timestamp) => {
      const final =
        response != null &&
        typeof response.status === "number" &&
        !CONTINUE_HEADERS.some((name) => response.headers?.has(name));
      const queued = reporter.track({
        method: request.method,
        url: request.url,
        status: threw ? 500 : final ? response.status : null,
        contentType: final ? response.headers?.get("content-type") : null,
        headers: request.headers,
        remoteAddress: typeof request.ip === "string" ? request.ip : null,
        timestamp,
      });
      if (queued && typeof event?.waitUntil === "function") event.waitUntil(reporter.flush());
    },
  );

  return async function revuMiddleware(request, event) {
    const timestamp = Date.now();
    /** @type {Response | null | undefined | void} */
    let response;
    try {
      response = middleware ? await middleware(request, event) : undefined;
    } catch (err) {
      observe(request, event, undefined, true, timestamp);
      throw err;
    }
    observe(request, event, response, false, timestamp);
    return response;
  };
}
