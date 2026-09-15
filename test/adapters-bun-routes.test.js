/**
 * The Bun routes adapter under a real `Bun.serve` router, over loopback only:
 * the app reports to a fake REVU API also served by Bun. Nothing leaves the
 * machine.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRevuServer } from "../src/index.js";
import { withRevu, withRevuRoutes } from "../src/adapters/bun.js";
import { BASE, BOT_UA, fakeFetch } from "./helpers.js";

/** @type {any[]} */
const received = [];

const api = Bun.serve({
  port: 0,
  async fetch(request) {
    received.push(...(await request.json()).events);
    return new Response(null, { status: 202 });
  },
});

const revu = createRevuServer({ ...BASE, endpoint: `http://127.0.0.1:${api.port}` });

const robotsPath = join(tmpdir(), `revu-routes-robots-${process.pid}.txt`);
await Bun.write(robotsPath, "User-agent: *\n");

/** @param {string} body */
const html = (body) => new Response(body, { headers: { "content-type": "text/html" } });

const app = Bun.serve({
  port: 0,
  routes: withRevuRoutes(revu, {
    "/": () => html("home"),
    "/pricing": { GET: () => html("pricing"), POST: () => html("posted") },
    "/about": html("about"),
    "/robots.txt": Bun.file(robotsPath),
    "/docs/:slug": (request) => html(request.params.slug),
    "/legacy": false,
  }),
  fetch: withRevu(
    revu,
    () => new Response("Not found", { status: 404, headers: { "content-type": "text/html" } }),
  ),
});

const base = `http://127.0.0.1:${app.port}`;

/**
 * Request each path as a crawler, then flush.
 * @param {string[]} paths
 * @returns {Promise<string[]>} Each response body, in order.
 */
async function crawl(paths) {
  received.length = 0;
  const bodies = [];
  for (const path of paths) {
    const response = await fetch(base + path, { headers: { "user-agent": BOT_UA } });
    bodies.push(await response.text());
  }
  await revu.flush();
  return bodies;
}

afterAll(async () => {
  await revu.shutdown();
  app.stop(true);
  api.stop(true);
});

describe("bun routes adapter", () => {
  test("reports every route shape, plus unmatched paths through fetch", async () => {
    await crawl(["/", "/pricing", "/about", "/robots.txt", "/docs/setup", "/legacy", "/missing"]);
    expect(received.map((e) => `${e.path} ${e.status}`)).toEqual([
      "/ 200",
      "/pricing 200",
      "/about 200",
      "/robots.txt 200",
      "/docs/setup 200",
      "/legacy 404",
      "/missing 404",
    ]);
    expect(received.every((e) => e.ip === "127.0.0.1")).toBe(true);
  });

  test("static routes serve their full body on every request", async () => {
    const bodies = await crawl(["/about", "/about", "/robots.txt", "/robots.txt"]);
    expect(bodies).toEqual(["about", "about", "User-agent: *\n", "User-agent: *\n"]);
    expect(received).toHaveLength(4);
  });

  test("keeps a per-method table's shape and wraps each method", () => {
    const get = () => html("get");
    const wrapped = withRevuRoutes(revu, { "/x": { GET: get, POST: html("post") } });
    expect(Object.keys(wrapped["/x"])).toEqual(["GET", "POST"]);
    expect(typeof wrapped["/x"].GET).toBe("function");
    expect(wrapped["/x"].GET).not.toBe(get);
    expect(typeof wrapped["/x"].POST).toBe("function");
  });

  test("passes through what it cannot observe", () => {
    class HTMLBundle {}
    const bundle = new HTMLBundle();
    const wrapped = withRevuRoutes(revu, { "/page": bundle, "/off": false });
    expect(wrapped["/page"]).toBe(bundle);
    expect(wrapped["/off"]).toBe(false);
  });

  test("returns the table itself when it cannot be read", () => {
    expect(withRevuRoutes(revu, /** @type {any} */ (null))).toBe(null);
    expect(withRevuRoutes(revu, /** @type {any} */ (undefined))).toBe(undefined);
  });

  test("a throwing route is tracked as 500 and its error re-thrown", async () => {
    const fetchImpl = fakeFetch();
    const reporter = createRevuServer({ ...BASE, fetch: fetchImpl });
    const routes = withRevuRoutes(reporter, {
      "/boom": () => {
        throw new Error("boom");
      },
    });
    const request = new Request("https://shop.example/boom", { headers: { "user-agent": BOT_UA } });
    const server = { requestIP: () => ({ address: "203.0.113.7" }) };
    await expect(routes["/boom"](request, server)).rejects.toThrow("boom");
    await reporter.flush();
    expect(fetchImpl.calls[0].body.events[0]).toMatchObject({ path: "/boom", status: 500 });
  });
});
