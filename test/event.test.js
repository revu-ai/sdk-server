import { describe, expect, test } from "bun:test";
import { resolveConfig } from "../src/config.js";
import { parseTarget, toCrawlEvent } from "../src/event.js";
import { BASE, BROWSER_UA, botRequest } from "./helpers.js";

/** @param {Record<string, unknown>} [extra] */
const configWith = (extra = {}) => {
  const { config } = resolveConfig({ ...BASE, fetch: async () => new Response(), ...extra });
  if (!config) throw new Error("config");
  return config;
};

describe("parseTarget", () => {
  test("splits origin-form targets by hand", () => {
    expect(parseTarget("/a/b?c=1#frag")).toEqual({ host: "", path: "/a/b", query: "c=1" });
    expect(parseTarget("//evil.example/x")).toEqual({
      host: "",
      path: "//evil.example/x",
      query: "",
    });
    expect(parseTarget("")).toEqual({ host: "", path: "/", query: "" });
  });

  test("parses absolute URLs", () => {
    expect(parseTarget("https://Shop.Example:8443/p?q=1")).toEqual({
      host: "shop.example:8443",
      path: "/p",
      query: "q=1",
    });
  });
});

describe("toCrawlEvent", () => {
  test("builds the full wire shape for a bot page hit", () => {
    const event = toCrawlEvent(
      botRequest({
        headers: {
          host: "Shop.Example",
          "user-agent": "curl/8.7.1",
          referer: "https://ref.example/some/path?secret=1",
          cookie: "session=abc",
          authorization: "Bearer nope",
        },
        timestamp: 0,
      }),
      configWith(),
    );
    expect(event).toEqual({
      event_type: "$crawl",
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      timestamp: "1970-01-01T00:00:00.000Z",
      host: "shop.example",
      path: "/pricing",
      method: "GET",
      status: 200,
      user_agent: "curl/8.7.1",
      ip: "203.0.113.7",
      referer_host: "ref.example",
    });
    // Nothing from cookies or other headers can leak into the event.
    expect(JSON.stringify(event)).not.toContain("abc");
    expect(JSON.stringify(event)).not.toContain("nope");
  });

  test("returns null for browsers, assets and non-page methods", () => {
    const config = configWith();
    expect(toCrawlEvent(botRequest({ headers: { "user-agent": BROWSER_UA } }), config)).toBeNull();
    expect(toCrawlEvent(botRequest({ url: "/main.js" }), config)).toBeNull();
    expect(toCrawlEvent(botRequest({ method: "POST" }), config)).toBeNull();
    expect(toCrawlEvent(botRequest({ contentType: "application/json" }), config)).toBeNull();
  });

  test("strips path parameters such as session ids", () => {
    const config = configWith();
    expect(toCrawlEvent(botRequest({ url: "/page;jsessionid=SECRET?x=1" }), config)?.path).toBe(
      "/page",
    );
    expect(
      toCrawlEvent(botRequest({ url: "https://h.example/a;sid=SECRET/b" }), config)?.path,
    ).toBe("/a");
  });

  test("reports redirects answered with a non-HTML body", () => {
    const event = toCrawlEvent(
      botRequest({ status: 301, contentType: "text/plain; charset=utf-8" }),
      configWith(),
    );
    expect(event?.status).toBe(301);
  });

  test("accepts trustProxy as a string from the environment", () => {
    const request = botRequest({
      headers: { "user-agent": "curl/8", "x-forwarded-for": "198.51.100.1" },
      remoteAddress: "10.0.0.9",
    });
    expect(toCrawlEvent(request, configWith({ trustProxy: "1" }))?.ip).toBe("198.51.100.1");
    expect(toCrawlEvent(request, configWith({ trustProxy: "true" }))?.ip).toBe("198.51.100.1");
    expect(toCrawlEvent(request, configWith({ trustProxy: "false" }))?.ip).toBe("10.0.0.9");
    expect(toCrawlEvent(request, configWith({ trustProxy: "junk" }))?.ip).toBe("10.0.0.9");
  });

  test("reports the forwarded host only behind a trusted proxy", () => {
    const request = botRequest({
      headers: {
        host: "127.0.0.1:3000",
        "x-forwarded-host": "Shop.Example, cdn.internal",
        "user-agent": "curl/8",
      },
    });
    expect(toCrawlEvent(request, configWith({ trustProxy: 1 }))?.host).toBe("shop.example");
    expect(toCrawlEvent(request, configWith())?.host).toBe("127.0.0.1:3000");
    const plain = botRequest({ headers: { host: "shop.example", "user-agent": "curl/8" } });
    expect(toCrawlEvent(plain, configWith({ trustProxy: 1 }))?.host).toBe("shop.example");
  });

  test("strips the query string by default", () => {
    const event = toCrawlEvent(botRequest({ url: "/search?q=private&page=2" }), configWith());
    expect(event?.path).toBe("/search");
  });

  test("keeps only allowlisted query parameters", () => {
    const event = toCrawlEvent(
      botRequest({ url: "/search?q=private&page=2&lang=en" }),
      configWith({ queryAllowlist: ["page", "lang"] }),
    );
    expect(event?.path).toBe("/search?page=2&lang=en");
  });

  test("normalizes status and falls back to the URL host", () => {
    const config = configWith();
    const event = toCrawlEvent(
      botRequest({
        url: "https://edge.example/x",
        status: 1000,
        headers: { "user-agent": "curl/8.7.1" },
      }),
      config,
    );
    expect(event?.status).toBeNull();
    expect(event?.host).toBe("edge.example");
    expect(event?.user_agent).toBe("curl/8.7.1");
  });

  test("bounds field lengths", () => {
    const event = toCrawlEvent(
      botRequest({
        url: `/${"a".repeat(5000)}`,
        headers: { host: "h", "user-agent": `bot ${"x".repeat(5000)}` },
      }),
      configWith(),
    );
    expect(event?.path.length).toBe(1024);
    expect(event?.user_agent.length).toBe(512);
  });

  test("an invalid referer is dropped, not sent", () => {
    const event = toCrawlEvent(
      botRequest({ headers: { "user-agent": "curl/8", referer: "not a url" } }),
      configWith(),
    );
    expect(event?.referer_host).toBeNull();
  });
});
