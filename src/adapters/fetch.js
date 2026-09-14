/**
 * @file Generic adapter for any server built on the WHATWG fetch handler
 * shape, `(request: Request, ...rest) => Response`. The Bun, Deno and
 * Cloudflare adapters are thin presets over this one. Use it directly for any
 * other fetch-style runtime or framework.
 *
 * The wrapper awaits the customer's handler, records the hit from the final
 * `Response`, and returns that response untouched. Reporting never delays it:
 * `track()` is synchronous, and when the runtime offers `waitUntil` the flush
 * is handed to it so the send happens after the response is delivered.
 */

import { safe } from "../utils.js";

/**
 * A fetch-style request handler.
 * @template {any[]} Rest
 * @typedef {(request: Request, ...rest: Rest) => Response | Promise<Response>} FetchHandler
 */

/**
 * Runtime-specific lookups, all optional.
 * @template {any[]} Rest
 * @typedef {object} FetchAdapterOptions
 * @property {(request: Request, ...rest: Rest) => string | null | undefined} [getRemoteAddress]
 *   Return the connecting client address (for example from `server.requestIP`
 *   on Bun or `info.remoteAddr` on Deno).
 * @property {(request: Request, ...rest: Rest) => ((promise: Promise<unknown>) => void) | null | undefined} [getWaitUntil]
 *   Return the runtime's `waitUntil`, when it has one, so the flush outlives
 *   the response.
 */

/**
 * Wrap a fetch handler so each response is reported.
 *
 * If the handler throws, the hit is recorded with status 500 and the error is
 * re-thrown unchanged, so the runtime's own error handling still applies.
 *
 * @example
 * import { createRevuServer } from "@revu-ai/server";
 * import { withRevu } from "@revu-ai/server/fetch";
 *
 * const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
 * export default { fetch: withRevu(revu, app.fetch) };
 *
 * @template {any[]} Rest
 * @param {import("../types.js").RevuServer} reporter
 * @param {FetchHandler<Rest>} handler
 * @param {FetchAdapterOptions<Rest>} [options]
 * @returns {(request: Request, ...rest: Rest) => Promise<Response>}
 */
export function withRevu(reporter, handler, options = {}) {
  const observe = safe(
    /**
     * @param {Request} request
     * @param {Rest} rest
     * @param {Response | null} response
     * @param {number} timestamp
     */
    (request, rest, response, timestamp) => {
      const isResponse = response != null && typeof response.status === "number";
      const queued = reporter.track({
        method: request.method,
        url: request.url,
        status: isResponse ? response.status : 500,
        contentType: isResponse ? response.headers?.get("content-type") : null,
        headers: request.headers,
        remoteAddress: options.getRemoteAddress?.(request, ...rest) ?? null,
        timestamp,
      });
      if (!queued) return;
      const waitUntil = options.getWaitUntil?.(request, ...rest);
      if (typeof waitUntil === "function") waitUntil(reporter.flush());
    },
  );

  /**
   * @this {unknown}
   * @param {Request} request
   * @param {Rest} rest
   * @returns {Promise<Response>}
   */
  return async function revuFetchHandler(request, ...rest) {
    const timestamp = Date.now();
    /** @type {Response} */
    let response;
    try {
      response = await handler.call(this, request, ...rest);
    } catch (err) {
      observe(request, rest, null, timestamp);
      throw err;
    }
    observe(request, rest, response, timestamp);
    return response;
  };
}
