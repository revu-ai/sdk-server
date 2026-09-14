import { describe, expect, test } from "bun:test";
import { createRevuServer } from "../src/index.js";
import { VERSION } from "../src/version.js";
import { BASE, BROWSER_UA, KEY, botRequest, fakeFetch, tick } from "./helpers.js";

/** @param {Record<string, unknown>} [extra] */
function setup(extra = {}, respond = undefined) {
  const fetch = fakeFetch(respond);
  const revu = createRevuServer(/** @type {any} */ ({ ...BASE, fetch, ...extra }));
  return { fetch, revu };
}

describe("createRevuServer configuration", () => {
  test("a missing, public or malformed key yields a disabled reporter", async () => {
    for (const serverKey of [undefined, "", "revu_pk_public", "sk_live_x"]) {
      const fetch = fakeFetch();
      const revu = createRevuServer(/** @type {any} */ ({ ...BASE, serverKey, fetch }));
      expect(revu.track(botRequest())).toBe(false);
      await revu.flush();
      await revu.shutdown();
      expect(fetch.calls.length).toBe(0);
    }
  });

  test("caps maxBatchSize at the API limit of 500", async () => {
    const { revu, fetch } = setup({ maxBatchSize: 10_000, flushAt: 10_000 });
    for (let i = 0; i < 501; i++) revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.map((call) => call.body.events.length)).toEqual([500, 1]);
  });

  test("warns once in debug when trustProxy: true has no ipHeader", () => {
    /** @type {string[]} */
    const lines = [];
    const warn = console.warn;
    console.warn = (...args) => lines.push(args.join(" "));
    try {
      const make = (/** @type {Record<string, unknown>} */ extra) =>
        createRevuServer(
          /** @type {any} */ ({ ...BASE, fetch: fakeFetch(), debug: true, ...extra }),
        );
      make({ trustProxy: true });
      make({ trustProxy: true, ipHeader: "x-real-ip" });
      make({ trustProxy: 1 });
    } finally {
      console.warn = warn;
    }
    expect(lines.filter((line) => line.includes("trustProxy: true"))).toHaveLength(1);
  });

  test("never throws on nonsense options", () => {
    expect(() => createRevuServer(/** @type {any} */ (null))).not.toThrow();
    expect(() => createRevuServer(/** @type {any} */ ("x"))).not.toThrow();
  });
});

describe("track", () => {
  test("is synchronous and returns whether the hit was queued", () => {
    const { revu } = setup();
    expect(revu.track(botRequest())).toBe(true);
    expect(revu.track(botRequest({ headers: { "user-agent": BROWSER_UA } }))).toBe(false);
    expect(revu.track(botRequest({ url: "/logo.svg" }))).toBe(false);
  });

  test("never throws on malformed input", () => {
    const { revu } = setup();
    expect(revu.track(/** @type {any} */ (null))).toBe(false);
    expect(revu.track(/** @type {any} */ ({}))).toBe(false); // no user agent: not reported
    expect(revu.track(/** @type {any} */ ({ headers: { "user-agent": "curl/8" } }))).toBe(true);
    const hostile = {
      get method() {
        throw new Error("boom");
      },
    };
    expect(revu.track(/** @type {any} */ (hostile))).toBe(false);
  });

  test("does not send on the request path", () => {
    const { revu, fetch } = setup({ flushAt: 1 });
    revu.track(botRequest());
    expect(fetch.calls.length).toBe(0);
  });
});

describe("flush", () => {
  test("posts the contract body with the server key", async () => {
    const { revu, fetch } = setup();
    revu.track(botRequest());
    await revu.flush();

    expect(fetch.calls.length).toBe(1);
    const [call] = fetch.calls;
    expect(call?.url).toBe("https://revu.test/v1/behavior/server-events");
    expect(call?.init.method).toBe("POST");
    expect(/** @type {any} */ (call?.init.headers).authorization).toBe(`Bearer ${KEY}`);
    expect(call?.body.sdk).toEqual({ name: "@revu-ai/server", version: VERSION });
    expect(Number.isNaN(Date.parse(call?.body.sent_at))).toBe(false);
    expect(call?.body.events).toHaveLength(1);
    expect(call?.body.events[0]).toMatchObject({ event_type: "$crawl", path: "/pricing" });
  });

  test("logs REVU's per-hit counts in debug", async () => {
    /** @type {string[]} */
    const lines = [];
    const warn = console.warn;
    console.warn = (...args) => lines.push(args.join(" "));
    try {
      const { revu } = setup({ debug: true }, () =>
        Response.json(
          { accepted: 1, duplicates: 0, rejected: { invalid: 0, unknown_host: 1, not_crawler: 0 } },
          { status: 202 },
        ),
      );
      revu.track(botRequest());
      revu.track(botRequest());
      await revu.flush();
    } finally {
      console.warn = warn;
    }
    expect(lines).toContain(
      "[revu/server] sent 2 hit(s): 1 accepted, 0 duplicate(s), 1 rejected (unknown_host 1)",
    );
  });

  test("does not read the response body outside debug", async () => {
    let read = false;
    const { revu } = setup({}, () => {
      const response = new Response("{}", { status: 202 });
      const json = response.json.bind(response);
      response.json = () => ((read = true), json());
      return response;
    });
    revu.track(botRequest());
    await revu.flush();
    expect(read).toBe(false);
  });

  test("spaces sends by minSendIntervalMs, so a burst goes out as one batch", async () => {
    const { revu, fetch } = setup({ minSendIntervalMs: 60 });
    revu.track(botRequest());
    await revu.flush(); // the first send goes out at once
    const started = Date.now();
    revu.track(botRequest());
    const pending = revu.flush();
    revu.track(botRequest()); // arrives during the wait and joins the same batch
    await pending;
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
    expect(fetch.calls.map((call) => call.body.events.length)).toEqual([1, 2]);
  });

  test("shutdown never waits for the send interval", async () => {
    const { revu, fetch } = setup({ minSendIntervalMs: 10_000 });
    revu.track(botRequest());
    await revu.flush();
    revu.track(botRequest());
    const started = Date.now();
    await revu.shutdown();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(fetch.calls).toHaveLength(2);
  });

  test("is a no-op on an empty queue", async () => {
    const { revu, fetch } = setup();
    await revu.flush();
    expect(fetch.calls.length).toBe(0);
  });

  test("flushAt triggers a deferred send", async () => {
    const { revu, fetch } = setup({ flushAt: 2 });
    revu.track(botRequest());
    revu.track(botRequest());
    expect(fetch.calls.length).toBe(0);
    await tick(5);
    expect(fetch.calls.length).toBe(1);
    expect(fetch.calls[0]?.body.events).toHaveLength(2);
  });

  test("the interval timer flushes queued hits", async () => {
    const { revu, fetch } = setup({ flushIntervalMs: 10 });
    revu.track(botRequest());
    await tick(40);
    expect(fetch.calls.length).toBe(1);
    await revu.shutdown();
  });

  test("splits into batches of maxBatchSize", async () => {
    const { revu, fetch } = setup({ maxBatchSize: 2 });
    for (let i = 0; i < 5; i++) revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.map((c) => c.body.events.length)).toEqual([2, 2, 1]);
  });

  test("keeps one request in flight and shares it between callers", async () => {
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((resolve) => (release = () => resolve(undefined)));
    const { revu, fetch } = setup({ maxBatchSize: 1 }, async () => {
      await gate;
      return new Response(null, { status: 202 });
    });
    revu.track(botRequest());
    revu.track(botRequest());
    const a = revu.flush();
    const b = revu.flush();
    revu.track(botRequest());
    release();
    await Promise.all([a, b]);
    expect(fetch.state.maxInflight).toBe(1);
    expect(fetch.calls.length).toBe(3);
  });

  test("drops the oldest hits when the queue is full", async () => {
    const { revu, fetch } = setup({ maxQueueSize: 2 });
    revu.track(botRequest({ url: "/one" }));
    revu.track(botRequest({ url: "/two" }));
    revu.track(botRequest({ url: "/three" }));
    await revu.flush();
    expect(fetch.calls[0]?.body.events.map((/** @type {any} */ e) => e.path)).toEqual([
      "/two",
      "/three",
    ]);
  });
});

describe("failure handling", () => {
  test("5xx gets one retry, then the batch is dropped and sending pauses", async () => {
    const { revu, fetch } = setup({}, () => new Response(null, { status: 503 }));
    revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.length).toBe(2);

    revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.length).toBe(2); // paused, nothing sent
  });

  test("a retry that succeeds delivers the batch", async () => {
    const { revu, fetch } = setup({}, (n) =>
      n === 1 ? new Response(null, { status: 502 }) : undefined,
    );
    revu.track(botRequest());
    await revu.flush();
    revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.length).toBe(3); // fail, retry ok, next batch not paused
  });

  test("network errors are retried once", async () => {
    const { revu, fetch } = setup({}, () => {
      throw new TypeError("network down");
    });
    revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.length).toBe(2);
  });

  test("a hanging request is aborted by the timeout", async () => {
    const { revu, fetch } = setup(
      { timeoutMs: 20 },
      (_n, call) =>
        new Promise((_resolve, reject) => {
          call.init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    revu.track(botRequest());
    const started = Date.now();
    await revu.flush();
    expect(fetch.calls.length).toBe(2);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("401 stops all reporting until restart", async () => {
    const { revu, fetch } = setup({}, () => new Response(null, { status: 401 }));
    revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.length).toBe(1);
    expect(revu.track(botRequest())).toBe(false);
    await revu.flush();
    expect(fetch.calls.length).toBe(1);
  });

  test("429 keeps the batch and pauses for Retry-After", async () => {
    const { revu, fetch } = setup({}, (n) =>
      n === 1 ? new Response(null, { status: 429, headers: { "retry-after": "0" } }) : undefined,
    );
    revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.length).toBe(1);
    await tick(2);
    await revu.flush();
    expect(fetch.calls.length).toBe(2);
    expect(fetch.calls[1]?.body.events).toHaveLength(1);
  });

  test("413 drops the batch and halves the batch size", async () => {
    const { revu, fetch } = setup({ backoffMs: 0 }, (n) =>
      n === 1 ? new Response(null, { status: 413 }) : undefined,
    );
    for (let i = 0; i < 4; i++) revu.track(botRequest());
    await revu.flush();
    for (let i = 0; i < 4; i++) revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.map((c) => c.body.events.length)).toEqual([4, 2, 2]);
  });

  test("other 4xx drops the batch without retry or pause", async () => {
    const { revu, fetch } = setup({}, (n) =>
      n === 1 ? new Response(null, { status: 400 }) : undefined,
    );
    revu.track(botRequest());
    await revu.flush();
    revu.track(botRequest());
    await revu.flush();
    expect(fetch.calls.length).toBe(2);
  });

  test("a fetch that throws synchronously never escapes", async () => {
    const fetch = () => {
      throw new Error("sync boom");
    };
    const revu = createRevuServer(/** @type {any} */ ({ ...BASE, fetch }));
    revu.track(botRequest());
    await expect(revu.flush()).resolves.toBeUndefined();
  });
});

describe("shutdown", () => {
  test("sends what is queued and stops accepting hits", async () => {
    const { revu, fetch } = setup();
    revu.track(botRequest());
    await revu.shutdown();
    expect(fetch.calls.length).toBe(1);
    expect(revu.track(botRequest())).toBe(false);
    await revu.shutdown();
    expect(fetch.calls.length).toBe(1);
  });

  test("is bounded by shutdownTimeoutMs", async () => {
    const { revu } = setup({ shutdownTimeoutMs: 20, timeoutMs: 5000 }, () => new Promise(() => {}));
    revu.track(botRequest());
    const started = Date.now();
    await revu.shutdown();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
