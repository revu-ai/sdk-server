/**
 * @file Bun adapter: wraps a `Bun.serve` fetch handler. The client address
 * comes from `server.requestIP(request)`, the socket address Bun provides.
 * Bun has no `waitUntil`. The reporter's flush timer does the sending.
 */

import { withRevu as withRevuFetch } from "./fetch.js";

/**
 * The parts of a Bun `Server` that are used.
 * @typedef {object} BunServerLike
 * @property {(request: Request) => { address: string } | null} [requestIP]
 */

/**
 * Wrap a `Bun.serve` fetch handler.
 *
 * @example
 * import { createRevuServer } from "@revu-ai/server";
 * import { withRevu } from "@revu-ai/server/bun";
 *
 * const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
 *
 * Bun.serve({
 *   fetch: withRevu(revu, (request, server) => new Response("hello")),
 * });
 *
 * @template {any[]} Rest
 * @param {import("../types.js").RevuServer} reporter
 * @param {(request: Request, server: BunServerLike, ...rest: Rest) => Response | Promise<Response>} handler
 * @returns {(request: Request, server: BunServerLike, ...rest: Rest) => Promise<Response>}
 */
export function withRevu(reporter, handler) {
  return /** @type {any} */ (
    withRevuFetch(reporter, /** @type {any} */ (handler), {
      getRemoteAddress: (request, server) =>
        /** @type {BunServerLike | undefined} */ (server)?.requestIP?.(request)?.address,
    })
  );
}
