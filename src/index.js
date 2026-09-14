/**
 * @file Public entry point of `@revu-ai/server`.
 *
 * The core is runtime-neutral: create one reporter per process with
 * {@link createRevuServer} and feed it requests through an adapter
 * (`@revu-ai/server/node`, `/fastify`, `/fetch`, `/bun`, `/deno`,
 * `/cloudflare`, `/next`) or by calling `track()` yourself.
 *
 * @example
 * import { createRevuServer } from "@revu-ai/server";
 *
 * const revu = createRevuServer({ serverKey: process.env.REVU_SERVER_KEY });
 * revu.track({ method: "GET", url: "/pricing", status: 200, headers, remoteAddress });
 */

export { createRevuServer } from "./reporter.js";
export { isPageRequest, looksAutomated } from "./filter.js";
export { resolveClientIp, normalizeIp } from "./ip.js";
export { DEFAULT_ENDPOINT, INGEST_PATH } from "./config.js";
export { VERSION } from "./version.js";

/** @typedef {import("./types.js").RevuServerOptions} RevuServerOptions */
/** @typedef {import("./types.js").RevuServer} RevuServer */
/** @typedef {import("./types.js").RequestInfo} RequestInfo */
/** @typedef {import("./types.js").CrawlEvent} CrawlEvent */
/** @typedef {import("./utils.js").HeadersLike} HeadersLike */
