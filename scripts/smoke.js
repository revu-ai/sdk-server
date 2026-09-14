/**
 * @file Cross-runtime smoke test. Uses only portable APIs so the same file
 * runs unchanged on Node 20+, Bun and Deno:
 *
 *   node scripts/smoke.js
 *   bun scripts/smoke.js
 *   deno run scripts/smoke.js
 *
 * It imports every entry point, reports one crawler hit through the fetch
 * adapter to a fake `fetch`, and checks the posted body. No network access.
 */

import { createRevuServer, VERSION } from "../src/index.js";
import { revuMiddleware } from "../src/adapters/node.js";
import { fastifyRevu } from "../src/adapters/fastify.js";
import { withRevu as withFetch } from "../src/adapters/fetch.js";
import { withRevu as withBun } from "../src/adapters/bun.js";
import { withRevu as withDeno } from "../src/adapters/deno.js";
import { withRevu as withCloudflare } from "../src/adapters/cloudflare.js";
import { withRevu as withNext } from "../src/adapters/next.js";

const runtime =
  typeof globalThis.Bun !== "undefined"
    ? "bun"
    : typeof globalThis.Deno !== "undefined"
      ? "deno"
      : `node ${globalThis.process?.version}`;

for (const fn of [
  revuMiddleware,
  fastifyRevu,
  withFetch,
  withBun,
  withDeno,
  withCloudflare,
  withNext,
]) {
  if (typeof fn !== "function") throw new Error("missing export");
}

/** @type {any[]} */
const posted = [];
const revu = createRevuServer({
  serverKey: "revu_sk_smoke",
  endpoint: "https://revu.invalid",
  flushIntervalMs: 0,
  flushOnExit: false,
  fetch: async (_url, init) => {
    posted.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 202 });
  },
});

const handler = withFetch(
  revu,
  async () => new Response("<p>ok</p>", { headers: { "content-type": "text/html" } }),
);
await handler(
  new Request("https://shop.example/pricing?q=1", { headers: { "user-agent": "curl/8" } }),
);
await revu.shutdown();

const event = posted[0]?.events?.[0];
if (
  !event ||
  event.path !== "/pricing" ||
  event.status !== 200 ||
  posted[0].sdk.version !== VERSION
) {
  throw new Error(`smoke failed on ${runtime}: ${JSON.stringify(posted)}`);
}
console.log(`smoke ok on ${runtime} (@revu-ai/server ${VERSION})`);
