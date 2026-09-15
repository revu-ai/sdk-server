/**
 * @file Size budget gate. Bundles each public entry point on its own with
 * Bun's bundler (minified, the way an edge or serverless bundle would include
 * it), gzips the result, and fails when any entry exceeds its budget. No
 * extra dev dependency: Bun's built-in bundler and gzip do the measuring.
 *
 *   bun run size
 */

/** Budgets in bytes, per entry: minified and gzipped. */
const BUDGETS = {
  "src/index.js": { min: 13_500, gzip: 5_600 },
  "src/adapters/node.js": { min: 1_500, gzip: 800 },
  "src/adapters/fastify.js": { min: 1_500, gzip: 800 },
  "src/adapters/fetch.js": { min: 1_500, gzip: 800 },
  "src/adapters/bun.js": { min: 1_500, gzip: 800 },
  "src/adapters/deno.js": { min: 1_500, gzip: 800 },
  // Includes the core: the Workers adapter creates its own reporter.
  "src/adapters/cloudflare.js": { min: 14_000, gzip: 5_800 },
  "src/adapters/next.js": { min: 1_500, gzip: 800 },
};

const root = new URL("../", import.meta.url);
let failed = false;
const rows = [];

for (const [entry, budget] of Object.entries(BUDGETS)) {
  const result = await Bun.build({
    entrypoints: [new URL(entry, root).pathname],
    minify: true,
    target: "browser",
    format: "esm",
  });
  if (!result.success) {
    console.error(result.logs);
    process.exit(1);
  }
  const code = await result.outputs[0].text();
  const min = new TextEncoder().encode(code).length;
  const gzip = Bun.gzipSync(code).length;
  const ok = min <= budget.min && gzip <= budget.gzip;
  if (!ok) failed = true;
  rows.push({
    entry,
    min: `${(min / 1000).toFixed(2)} kB / ${(budget.min / 1000).toFixed(1)} kB`,
    gzip: `${(gzip / 1000).toFixed(2)} kB / ${(budget.gzip / 1000).toFixed(1)} kB`,
    ok: ok ? "yes" : "OVER",
  });
}

console.table(rows);
if (failed) {
  console.error("size: budget exceeded");
  process.exit(1);
}
