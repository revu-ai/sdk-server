/**
 * @file Shared test fixtures: user agents and a recording fake `fetch`. No
 * test touches the real network.
 */

/** A crawler user agent in the common `compatible; NameBot` shape. */
export const BOT_UA = "Mozilla/5.0 (compatible; ExampleBot/1.0; +https://example.com/bot)";

/** An ordinary desktop browser. */
export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** A valid-looking secret server key. */
export const KEY = "revu_sk_test_123";

/**
 * Options every reporter test starts from: no timer, no retry delay, no send
 * spacing, no exit hook, so tests drive flushing explicitly and finish
 * instantly.
 */
export const BASE = Object.freeze({
  serverKey: KEY,
  endpoint: "https://revu.test",
  flushIntervalMs: 0,
  retryDelayMs: 0,
  minSendIntervalMs: 0,
  flushOnExit: false,
});

/**
 * @typedef {object} FetchCall
 * @property {string} url
 * @property {RequestInit} init
 * @property {any} body Parsed JSON body.
 */

/**
 * A fake `fetch` that records each call and answers with `respond(callIndex)`
 * (a `Response`, a thrown error, or a promise of either). Defaults to 202.
 * Tracks the maximum number of concurrent in-flight calls.
 *
 * @param {(n: number, call: FetchCall) => Response | Promise<Response> | undefined} [respond]
 */
export function fakeFetch(respond) {
  /** @type {FetchCall[]} */
  const calls = [];
  const state = { inflight: 0, maxInflight: 0 };
  /** @param {string} url @param {RequestInit} init */
  const fn = async (url, init) => {
    const call = { url, init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    state.inflight += 1;
    state.maxInflight = Math.max(state.maxInflight, state.inflight);
    try {
      return (await respond?.(calls.length, call)) ?? new Response(null, { status: 202 });
    } finally {
      state.inflight -= 1;
    }
  };
  return Object.assign(fn, { calls, state });
}

/**
 * A bot page request, overridable per test.
 * @param {Record<string, unknown>} [overrides]
 * @returns {any}
 */
export function botRequest(overrides = {}) {
  return {
    method: "GET",
    url: "/pricing",
    status: 200,
    contentType: "text/html; charset=utf-8",
    headers: { host: "shop.example", "user-agent": BOT_UA },
    remoteAddress: "203.0.113.7",
    ...overrides,
  };
}

/** Wait for queued timers and microtasks to run. */
export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
