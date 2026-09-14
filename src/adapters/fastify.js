/**
 * @file Fastify adapter: a plugin that records each hit from the `onResponse`
 * hook, which Fastify runs after the response has been sent. The plugin opts
 * out of Fastify's encapsulation (the `skip-override` symbol), so one
 * registration covers every route in the app. No Fastify import is needed.
 */

import { safe } from "../utils.js";

/**
 * The parts of a Fastify request that are read.
 * @typedef {object} FastifyRequestLike
 * @property {string} method
 * @property {string} url
 * @property {Record<string, string | string[] | undefined>} headers
 * @property {{ url?: string, socket?: { remoteAddress?: string | undefined } | null }} [raw]
 */

/**
 * The parts of a Fastify reply that are read.
 * @typedef {object} FastifyReplyLike
 * @property {number} statusCode
 * @property {(name: string) => unknown} getHeader
 */

/**
 * The parts of a Fastify instance that are used.
 * @typedef {object} FastifyInstanceLike
 * @property {(name: "onResponse", hook: (request: FastifyRequestLike, reply: FastifyReplyLike) => Promise<void>) => unknown} addHook
 */

/**
 * Create the plugin.
 *
 * @example
 * import Fastify from "fastify";
 * import { createRevuServer } from "@revu-ai/server";
 * import { fastifyRevu } from "@revu-ai/server/fastify";
 *
 * const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
 * const app = Fastify();
 * await app.register(fastifyRevu(revu));
 * app.addHook("onClose", () => revu.shutdown());
 *
 * @param {import("../types.js").RevuServer} reporter
 * @returns {(fastify: FastifyInstanceLike, options: unknown, done: (err?: Error) => void) => void}
 */
export function fastifyRevu(reporter) {
  const observe = safe(
    /**
     * @param {FastifyRequestLike} request
     * @param {FastifyReplyLike} reply
     */
    (request, reply) => {
      const contentType = reply.getHeader("content-type");
      reporter.track({
        method: request.method,
        url: request.raw?.url || request.url,
        status: reply.statusCode,
        contentType: contentType == null ? null : String(contentType),
        headers: request.headers,
        remoteAddress: request.raw?.socket?.remoteAddress ?? null,
      });
    },
  );

  /** @type {(fastify: FastifyInstanceLike, options: unknown, done: (err?: Error) => void) => void} */
  function revuPlugin(fastify, _options, done) {
    try {
      fastify.addHook("onResponse", async (request, reply) => {
        observe(request, reply);
      });
    } catch {}
    done();
  }

  const plugin = /** @type {any} */ (revuPlugin);
  plugin[Symbol.for("skip-override")] = true;
  plugin[Symbol.for("fastify.display-name")] = "@revu-ai/server";
  return revuPlugin;
}
