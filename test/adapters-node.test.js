import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { fastifyRevu } from "../src/adapters/fastify.js";
import { revuMiddleware } from "../src/adapters/node.js";
import { BOT_UA, BROWSER_UA } from "./helpers.js";

/** A reporter stub that records what it is asked to track. */
function recorder() {
  /** @type {any[]} */
  const tracked = [];
  return {
    tracked,
    track: (/** @type {any} */ info) => (tracked.push(info), true),
    flush: async () => {},
    shutdown: async () => {},
  };
}

/** Fake Node request and response pair. */
function nodePair({ method = "GET", url = "/docs?x=1", ua = BOT_UA } = {}) {
  const req = {
    method,
    url,
    headers: { host: "shop.example", "user-agent": ua },
    socket: { remoteAddress: "203.0.113.7" },
  };
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    getHeader: (/** @type {string} */ name) => (name === "content-type" ? "text/html" : undefined),
  });
  return { req, res };
}

describe("revuMiddleware (node, express, connect)", () => {
  test("tracks on finish with status, content type and socket address", () => {
    const revu = recorder();
    const { req, res } = nodePair();
    let nextCalls = 0;
    revuMiddleware(revu)(req, res, () => nextCalls++);
    expect(nextCalls).toBe(1);
    expect(revu.tracked).toHaveLength(0);

    res.statusCode = 404;
    res.emit("finish");
    expect(revu.tracked).toHaveLength(1);
    expect(revu.tracked[0]).toMatchObject({
      method: "GET",
      url: "/docs?x=1",
      status: 404,
      contentType: "text/html",
      remoteAddress: "203.0.113.7",
    });
  });

  test("prefers Express originalUrl", () => {
    const revu = recorder();
    const { req, res } = nodePair();
    revuMiddleware(revu)({ ...req, originalUrl: "/blog/post" }, res);
    res.emit("finish");
    expect(revu.tracked[0].url).toBe("/blog/post");
  });

  test("skips browsers and non-page methods without adding a listener", () => {
    const revu = recorder();
    for (const pair of [nodePair({ ua: BROWSER_UA }), nodePair({ method: "POST" })]) {
      revuMiddleware(revu)(pair.req, pair.res);
      expect(pair.res.listenerCount("finish")).toBe(0);
    }
  });

  test("a throwing reporter never reaches the host", () => {
    const revu = {
      ...recorder(),
      track: () => {
        throw new Error("boom");
      },
    };
    const { req, res } = nodePair();
    let nextCalls = 0;
    expect(() => revuMiddleware(revu)(req, res, () => nextCalls++)).not.toThrow();
    expect(() => res.emit("finish")).not.toThrow();
    expect(nextCalls).toBe(1);
  });

  test("errors thrown by next() are the host's and propagate", () => {
    const { req, res } = nodePair();
    expect(() =>
      revuMiddleware(recorder())(req, res, () => {
        throw new Error("route error");
      }),
    ).toThrow("route error");
  });
});

describe("fastifyRevu", () => {
  test("registers a global onResponse hook that tracks the reply", async () => {
    const revu = recorder();
    /** @type {any} */
    let hook;
    const fastify = {
      addHook: (/** @type {string} */ _name, /** @type {any} */ fn) => (hook = fn),
    };
    const plugin = fastifyRevu(revu);
    let done = 0;
    plugin(fastify, {}, () => done++);
    expect(done).toBe(1);
    expect(/** @type {any} */ (plugin)[Symbol.for("skip-override")]).toBe(true);

    await hook(
      {
        method: "GET",
        url: "/docs",
        headers: { "user-agent": BOT_UA },
        raw: { url: "/docs?page=2", socket: { remoteAddress: "203.0.113.7" } },
      },
      { statusCode: 200, getHeader: () => "text/html" },
    );
    expect(revu.tracked[0]).toMatchObject({
      url: "/docs?page=2",
      status: 200,
      remoteAddress: "203.0.113.7",
    });
  });
});
