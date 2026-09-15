/**
 * @file Bun adapter: wraps a `Bun.serve` fetch handler and its `routes`
 * table. The client address comes from `server.requestIP(request)`, the
 * socket address Bun provides. Bun has no `waitUntil`. The reporter's flush
 * timer does the sending.
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
 * Bun calls `fetch` only for paths no entry in `routes` matches. An app that
 * uses `routes` also needs {@link withRevuRoutes}.
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

/**
 * Wrap a `Bun.serve` `routes` table so every matched route is reported.
 *
 * Returns a new table with the same paths. Each value is observed through
 * {@link withRevu}:
 *
 * - A handler function is wrapped.
 * - A per-method object (`{ GET, POST }`) keeps its shape, and each method
 *   is wrapped.
 * - A static `Response` or `Bun.file` becomes a handler that serves a copy of
 *   it, so crawler reads of static pages and files such as `robots.txt` are
 *   reported. Bun answers those routes natively with an ETag or
 *   Last-Modified and `304 Not Modified`. Once wrapped, they always send the
 *   full body.
 * - Anything else passes through untouched and is not reported: HTML imports
 *   (which Bun bundles itself) and `false` (which falls through to `fetch`).
 *
 * Wrap `fetch` with {@link withRevu} as well, so unmatched paths are
 * reported too.
 *
 * @example
 * import { createRevuServer } from "@revu-ai/server";
 * import { withRevu, withRevuRoutes } from "@revu-ai/server/bun";
 *
 * const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
 *
 * Bun.serve({
 *   routes: withRevuRoutes(revu, {
 *     "/": () => new Response("home"),
 *     "/pricing": { GET: () => new Response("pricing") },
 *     "/robots.txt": Bun.file("public/robots.txt"),
 *   }),
 *   fetch: withRevu(revu, () => new Response("Not found", { status: 404 })),
 * });
 *
 * @template {Record<string, unknown>} Routes
 * @param {import("../types.js").RevuServer} reporter
 * @param {Routes} routes
 * @returns {Routes} The wrapped table, or `routes` itself when it cannot be read.
 */
export function withRevuRoutes(reporter, routes) {
  try {
    /** @type {Record<string, unknown>} */
    const wrapped = {};
    for (const [path, value] of Object.entries(routes)) {
      wrapped[path] = isPlainObject(value)
        ? Object.fromEntries(
            Object.entries(value).map(([method, route]) => [method, wrapRoute(reporter, route)]),
          )
        : wrapRoute(reporter, value);
    }
    return /** @type {Routes} */ (wrapped);
  } catch {
    return routes;
  }
}

/**
 * Wrap one route value, or return it untouched when it cannot be observed.
 * @param {import("../types.js").RevuServer} reporter
 * @param {unknown} value
 * @returns {unknown}
 */
function wrapRoute(reporter, value) {
  if (typeof value === "function") return withRevu(reporter, /** @type {any} */ (value));
  if (value instanceof Response) return withRevu(reporter, () => value.clone());
  if (value instanceof Blob) return withRevu(reporter, () => new Response(value));
  return value;
}

/**
 * A per-method route table, as opposed to a class instance such as an HTML
 * import.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
