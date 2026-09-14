/**
 * @file Cloudflare Workers adapter: wraps a module Worker's `fetch(request,
 * env, ctx)` handler.
 *
 * - Secrets live on `env`, which only exists inside a request, so the adapter
 *   accepts an options factory `(env) => options` and creates the reporter
 *   once per isolate on the first request.
 * - The client address is `CF-Connecting-IP`, which Cloudflare's edge sets
 *   on every request that reaches a Worker.
 * - Each reported hit is flushed through `ctx.waitUntil`, so the send runs
 *   after the response and survives the end of the request. The periodic
 *   timer is off by default for reporters the adapter creates.
 */

import { createRevuServer } from "../reporter.js";
import { withRevu as withRevuFetch } from "./fetch.js";

/**
 * The parts of a Worker `ExecutionContext` that are used.
 * @typedef {object} ExecutionContextLike
 * @property {(promise: Promise<unknown>) => void} [waitUntil]
 */

/**
 * Wrap a Worker fetch handler.
 *
 * @example
 * import { withRevu } from "@revu-ai/server/cloudflare";
 *
 * export default {
 *   fetch: withRevu(
 *     (env) => ({ serverKey: env.REVU_SERVER_KEY }),
 *     async (request, env, ctx) => fetch(request),
 *   ),
 * };
 *
 * @template Env
 * @param {import("../types.js").RevuServer | ((env: Env) => import("../types.js").RevuServerOptions)} reporterOrOptions
 *   A reporter, or a function that builds reporter options from `env`.
 * @param {(request: Request, env: Env, ctx: ExecutionContextLike) => Response | Promise<Response>} handler
 * @returns {(request: Request, env: Env, ctx: ExecutionContextLike) => Promise<Response>}
 */
export function withRevu(reporterOrOptions, handler) {
  /** @type {import("../types.js").RevuServer | null} */
  let reporter = typeof reporterOrOptions === "function" ? null : reporterOrOptions;

  /** Stand-in for a request whose options factory threw. */
  /** @type {import("../types.js").RevuServer} */
  const inactive = { track: () => false, flush: async () => {}, shutdown: async () => {} };

  /**
   * The isolate's reporter, created on the first request whose options
   * factory succeeds. A factory that throws is retried on the next request
   * instead of leaving the isolate without reporting for its lifetime.
   * @param {Env} env
   */
  const getReporter = (env) => {
    if (reporter) return reporter;
    /** @type {import("../types.js").RevuServerOptions} */
    let options;
    try {
      options = /** @type {(env: Env) => import("../types.js").RevuServerOptions} */ (
        reporterOrOptions
      )(env);
    } catch {
      return inactive;
    }
    reporter = createRevuServer(
      /** @type {import("../types.js").RevuServerOptions} */ ({
        flushIntervalMs: 0,
        flushOnExit: false,
        ...options,
      }),
    );
    return reporter;
  };

  /** Stable facade so the fetch wrapper can be built once. */
  /** @type {import("../types.js").RevuServer} */
  let current = inactive;
  const facade = {
    /** @type {import("../types.js").RevuServer["track"]} */
    track: (request) => current.track(request),
    flush: () => current.flush(),
    shutdown: () => current.shutdown(),
  };

  /** @type {import("./fetch.js").FetchAdapterOptions<[Env, ExecutionContextLike]>} */
  const hooks = {
    getRemoteAddress: (request) => request.headers.get("cf-connecting-ip"),
    getWaitUntil: (_request, _env, ctx) =>
      typeof ctx?.waitUntil === "function" ? ctx.waitUntil.bind(ctx) : null,
  };
  const wrapped = withRevuFetch(facade, handler, hooks);

  /**
   * @this {unknown}
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContextLike} ctx
   * @returns {Promise<Response>}
   */
  return async function revuWorkerFetch(request, env, ctx) {
    try {
      current = getReporter(env);
    } catch {}
    return wrapped.call(this, request, env, ctx);
  };
}
