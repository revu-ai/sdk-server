/**
 * @file Node adapter: one middleware for the `node:http` server and every
 * framework built on its `(req, res, next)` shape (Express, Connect, and
 * similar). The hit is recorded on the response `finish` event, after the
 * response has been handed to the socket, so the request path pays only for
 * registering one listener, and only on GET or HEAD requests from clients
 * that look automated.
 *
 * Structural types are used instead of `node:http` so this module (and the
 * package) has no Node-specific import and no dependency on Node's types.
 */

import { looksAutomated } from "../filter.js";
import { getHeader, safe } from "../utils.js";

/**
 * The parts of `http.IncomingMessage` (or an Express request) that are read.
 * @typedef {object} NodeRequestLike
 * @property {string} [method]
 * @property {string} [url]
 * @property {string} [originalUrl] Set by Express. Preferred over `url` inside mounted routers.
 * @property {Record<string, string | string[] | undefined>} headers
 * @property {{ remoteAddress?: string | undefined } | null} [socket]
 */

/**
 * The parts of `http.ServerResponse` that are read.
 * @typedef {object} NodeResponseLike
 * @property {number} statusCode
 * @property {(name: string) => unknown} getHeader
 * @property {(event: "finish", listener: () => void) => unknown} once
 */

/**
 * Create the middleware.
 *
 * @example
 * // Express
 * import express from "express";
 * import { createRevuServer } from "@revu-ai/server";
 * import { revuMiddleware } from "@revu-ai/server/node";
 *
 * const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
 * const app = express();
 * app.use(revuMiddleware(revu));
 *
 * @example
 * // node:http
 * const track = revuMiddleware(revu);
 * http.createServer((req, res) => {
 *   track(req, res);
 *   res.end("hello");
 * });
 *
 * @param {import("../types.js").RevuServer} reporter
 * @returns {(req: NodeRequestLike, res: NodeResponseLike, next?: (err?: unknown) => void) => void}
 *   Middleware. Calls `next()` exactly once when given, and never throws.
 */
export function revuMiddleware(reporter) {
  const observe = safe(
    /**
     * @param {NodeRequestLike} req
     * @param {NodeResponseLike} res
     */
    (req, res) => {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") return;
      if (!looksAutomated(getHeader(req.headers, "user-agent"))) return;

      const timestamp = Date.now();
      const url = req.originalUrl || req.url || "/";
      res.once(
        "finish",
        safe(() => {
          const contentType = res.getHeader("content-type");
          reporter.track({
            method,
            url,
            status: res.statusCode,
            contentType: contentType == null ? null : String(contentType),
            headers: req.headers,
            remoteAddress: req.socket?.remoteAddress ?? null,
            timestamp,
          });
        }),
      );
    },
  );

  return function revu(req, res, next) {
    observe(req, res);
    if (typeof next === "function") next();
  };
}
