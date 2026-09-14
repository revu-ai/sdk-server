/**
 * @file Deno adapter: wraps a `Deno.serve` handler. The client address comes
 * from `info.remoteAddr`, the socket address Deno provides. The reporter's
 * flush timer does the sending.
 */

import { withRevu as withRevuFetch } from "./fetch.js";

/**
 * The parts of Deno's `ServeHandlerInfo` that are used.
 * @typedef {object} DenoServeInfoLike
 * @property {{ hostname?: string }} [remoteAddr]
 */

/**
 * Wrap a `Deno.serve` handler.
 *
 * @example
 * import { createRevuServer } from "npm:@revu-ai/server";
 * import { withRevu } from "npm:@revu-ai/server/deno";
 *
 * const revu = createRevuServer({ serverKey: Deno.env.get("REVU_SERVER_KEY") });
 *
 * Deno.serve(withRevu(revu, (request, info) => new Response("hello")));
 *
 * @template {any[]} Rest
 * @param {import("../types.js").RevuServer} reporter
 * @param {(request: Request, info: DenoServeInfoLike, ...rest: Rest) => Response | Promise<Response>} handler
 * @returns {(request: Request, info: DenoServeInfoLike, ...rest: Rest) => Promise<Response>}
 */
export function withRevu(reporter, handler) {
  return /** @type {any} */ (
    withRevuFetch(reporter, /** @type {any} */ (handler), {
      getRemoteAddress: (_request, info) =>
        /** @type {DenoServeInfoLike | undefined} */ (info)?.remoteAddr?.hostname,
    })
  );
}
