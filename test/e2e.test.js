/**
 * End to end over loopback only: a real `node:http` app using the Node
 * middleware reports to a fake REVU API served by `Bun.serve`. Nothing leaves
 * the machine.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import http from "node:http";
import { createRevuServer } from "../src/index.js";
import { revuMiddleware } from "../src/adapters/node.js";
import { BROWSER_UA, KEY } from "./helpers.js";

/** @type {{ auth: string | null, body: any }[]} */
const received = [];

/** Fake REVU API implementing the proposed contract. */
const api = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/behavior/server-events") {
      return new Response(null, { status: 404 });
    }
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${KEY}`) return new Response(null, { status: 401 });
    received.push({ auth, body: await request.json() });
    return new Response(null, { status: 202 });
  },
});

const revu = createRevuServer({
  serverKey: KEY,
  endpoint: `http://127.0.0.1:${api.port}`,
  flushIntervalMs: 0,
  flushOnExit: false,
});
const track = revuMiddleware(revu);

const app = http.createServer((req, res) => {
  track(req, res);
  if (req.url === "/robots.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("User-agent: *\n");
  } else if (req.url?.startsWith("/static/")) {
    res.writeHead(200, { "content-type": "application/javascript" });
    res.end("0");
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>page</h1>");
  }
});

/** @type {string} */
let base = "";

beforeAll(async () => {
  await new Promise((resolve) => app.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = /** @type {import("node:net").AddressInfo} */ (app.address());
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await revu.shutdown();
  app.close();
  api.stop(true);
});

test("crawler hits reach the REVU API; browsers and assets do not", async () => {
  const bot = { "user-agent": "curl/8.7.1", referer: "https://ref.example/x?y=1" };
  await (await fetch(`${base}/pricing?session=secret`, { headers: bot })).text();
  await (await fetch(`${base}/robots.txt`, { headers: bot })).text();
  await (await fetch(`${base}/static/app.js`, { headers: bot })).text();
  await (await fetch(`${base}/pricing`, { headers: { "user-agent": BROWSER_UA } })).text();

  await revu.flush();

  expect(received).toHaveLength(1);
  const { body } = /** @type {{ body: any }} */ (received[0]);
  expect(body.sdk.name).toBe("@revu-ai/server");
  expect(Number.isNaN(Date.parse(body.sent_at))).toBe(false);
  expect(body.events.map((/** @type {any} */ e) => e.path)).toEqual(["/pricing", "/robots.txt"]);
  expect(body.events[0]).toMatchObject({
    event_type: "$crawl",
    host: base.replace("http://", ""),
    method: "GET",
    status: 200,
    user_agent: "curl/8.7.1",
    ip: "127.0.0.1",
    referer_host: "ref.example",
  });
  expect(JSON.stringify(body)).not.toContain("secret");
});
