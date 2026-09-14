import { describe, expect, test } from "bun:test";
import { withRevu as withBun } from "../src/adapters/bun.js";
import { withRevu as withCloudflare } from "../src/adapters/cloudflare.js";
import { withRevu as withDeno } from "../src/adapters/deno.js";
import { withRevu as withFetch } from "../src/adapters/fetch.js";
import { withRevu as withNext } from "../src/adapters/next.js";
import { BASE, BOT_UA, fakeFetch } from "./helpers.js";

/** A reporter stub that records tracked hits and flush calls. */
function recorder() {
  /** @type {any[]} */
  const tracked = [];
  const state = { flushes: 0 };
  return {
    tracked,
    state,
    track: (/** @type {any} */ info) => (tracked.push(info), true),
    flush: async () => {
      state.flushes += 1;
    },
    shutdown: async () => {},
  };
}

/** @param {Record<string, string>} [headers] */
const botRequest = (headers = {}) =>
  new Request("https://shop.example/pricing?utm=x", {
    headers: { "user-agent": BOT_UA, ...headers },
  });

const html = () => new Response("<h1>hi</h1>", { headers: { "content-type": "text/html" } });

describe("fetch adapter", () => {
  test("returns the handler's response untouched and tracks it", async () => {
    const revu = recorder();
    const original = html();
    const handler = withFetch(revu, async () => original);
    const response = await handler(botRequest());
    expect(response).toBe(original);
    expect(revu.tracked[0]).toMatchObject({
      method: "GET",
      url: "https://shop.example/pricing?utm=x",
      status: 200,
      contentType: "text/html",
    });
  });

  test("hands the flush to waitUntil when available", async () => {
    const revu = recorder();
    /** @type {Promise<unknown>[]} */
    const pending = [];
    const handler = withFetch(revu, async () => html(), {
      getWaitUntil: () => (/** @type {Promise<unknown>} */ p) => pending.push(p),
    });
    await handler(botRequest());
    expect(pending).toHaveLength(1);
    expect(revu.state.flushes).toBe(1);
  });

  test("a throwing handler is tracked as 500 and its error re-thrown", async () => {
    const revu = recorder();
    const handler = withFetch(revu, async () => {
      throw new Error("app error");
    });
    await expect(handler(botRequest())).rejects.toThrow("app error");
    expect(revu.tracked[0].status).toBe(500);
  });

  test("a throwing reporter never affects the response", async () => {
    const revu = {
      ...recorder(),
      track: () => {
        throw new Error("boom");
      },
    };
    const handler = withFetch(revu, async () => html());
    expect((await handler(botRequest())).status).toBe(200);
  });
});

describe("bun adapter", () => {
  test("reads the client address from server.requestIP", async () => {
    const revu = recorder();
    const server = { requestIP: () => ({ address: "203.0.113.7" }) };
    await withBun(revu, async () => html())(botRequest(), server);
    expect(revu.tracked[0].remoteAddress).toBe("203.0.113.7");
  });
});

describe("deno adapter", () => {
  test("reads the client address from info.remoteAddr", async () => {
    const revu = recorder();
    await withDeno(revu, async () => html())(botRequest(), {
      remoteAddr: { hostname: "203.0.113.8" },
    });
    expect(revu.tracked[0].remoteAddress).toBe("203.0.113.8");
  });
});

describe("cloudflare adapter", () => {
  test("builds the reporter from env once and flushes through ctx.waitUntil", async () => {
    const fetch = fakeFetch();
    let factoryCalls = 0;
    const worker = withCloudflare(
      (/** @type {any} */ env) => (
        factoryCalls++,
        { ...BASE, serverKey: env.REVU_SERVER_KEY, fetch }
      ),
      async () => html(),
    );
    /** @type {Promise<unknown>[]} */
    const pending = [];
    const ctx = { waitUntil: (/** @type {Promise<unknown>} */ p) => pending.push(p) };
    const env = { REVU_SERVER_KEY: "revu_sk_worker" };

    await worker(botRequest({ "cf-connecting-ip": "198.51.100.9" }), env, ctx);
    await worker(botRequest({ "cf-connecting-ip": "198.51.100.9" }), env, ctx);
    await Promise.all(pending);

    expect(factoryCalls).toBe(1);
    expect(pending).toHaveLength(2);
    const events = fetch.calls.flatMap((c) => c.body.events);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ ip: "198.51.100.9", path: "/pricing", status: 200 });
    expect(/** @type {any} */ (fetch.calls[0]?.init.headers).authorization).toBe(
      "Bearer revu_sk_worker",
    );
  });

  test("a throwing options factory leaves the worker serving", async () => {
    const worker = withCloudflare(
      () => {
        throw new Error("no env");
      },
      async () => html(),
    );
    const response = await worker(botRequest(), {}, {});
    expect(response.status).toBe(200);
  });

  test("a factory that threw is retried on the next request", async () => {
    const fetch = fakeFetch();
    let calls = 0;
    const worker = withCloudflare(
      (/** @type {any} */ env) => {
        calls++;
        if (!env.ready) throw new Error("not yet");
        return { ...BASE, fetch };
      },
      async () => html(),
    );
    /** @type {Promise<unknown>[]} */
    const pending = [];
    const ctx = { waitUntil: (/** @type {Promise<unknown>} */ p) => pending.push(p) };
    await worker(botRequest(), { ready: false }, ctx);
    await worker(botRequest(), { ready: true }, ctx);
    await worker(botRequest(), { ready: true }, ctx);
    await Promise.all(pending);
    expect(calls).toBe(2);
    expect(fetch.calls.flatMap((c) => c.body.events)).toHaveLength(2);
  });
});

describe("next adapter", () => {
  test("reports status null when routing continues", async () => {
    const revu = recorder();
    const next = new Response(null, { headers: { "x-middleware-next": "1" } });
    /** @type {Promise<unknown>[]} */
    const pending = [];
    const event = { waitUntil: (/** @type {Promise<unknown>} */ p) => pending.push(p) };
    const result = await withNext(revu, () => next)(botRequest(), event);
    expect(result).toBe(next);
    expect(revu.tracked[0]).toMatchObject({ status: null, contentType: null });
    expect(pending).toHaveLength(1);
  });

  test("reports the status of a final middleware response", async () => {
    const revu = recorder();
    const redirect = new Response(null, { status: 308, headers: { location: "/new" } });
    await withNext(revu, () => redirect)(botRequest(), {});
    expect(revu.tracked[0].status).toBe(308);
  });

  test("works without a wrapped middleware and uses request.ip", async () => {
    const revu = recorder();
    const request = Object.assign(botRequest(), { ip: "203.0.113.5" });
    const result = await withNext(revu)(request, {});
    expect(result).toBeUndefined();
    expect(revu.tracked[0]).toMatchObject({ status: null, remoteAddress: "203.0.113.5" });
  });
});
