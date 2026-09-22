import { describe, expect, test } from "bun:test";
import { isPageRequest, looksAutomated } from "../src/filter.js";

describe("looksAutomated", () => {
  const browsers = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  ];

  for (const ua of browsers) {
    test(`browser is not automated: ${ua.slice(0, 60)}`, () => {
      expect(looksAutomated(ua)).toBe(false);
    });
  }

  const automated = [
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
    "CCBot/2.0 (https://commoncrawl.org/faq/)",
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (compatible; Claude-User/1.0)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36",
    "WhatsApp/2.23.20.0",
    "curl/8.7.1",
    "python-requests/2.32.3",
    "Go-http-client/1.1",
    "node",
  ];

  for (const ua of automated) {
    test(`automated: ${ua.slice(0, 60)}`, () => {
      expect(looksAutomated(ua)).toBe(true);
    });
  }

  test("empty or missing user agent is not reported", () => {
    expect(looksAutomated("")).toBe(false);
    expect(looksAutomated("   ")).toBe(false);
    expect(looksAutomated(undefined)).toBe(false);
    expect(looksAutomated(null)).toBe(false);
  });

  test("health-check probes are not reported", () => {
    for (const ua of [
      "kube-probe/1.29",
      "ELB-HealthChecker/2.0",
      "GoogleHC/1.0",
      "Consul Health Check",
      "Envoy/HC",
    ]) {
      expect(looksAutomated(ua)).toBe(false);
    }
  });
});

describe("looksAutomated: browser user agents that contradict themselves", () => {
  // The same cases the REVU API tests its classifier with, so both sides agree
  // on every one: the API counts the first group as bots and the second as
  // people.
  const spoofed = {
    "the legacy Edge/ token next to Chrome 79 or later":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.60 Safari/537.36 Edge/12.246",
    "an iOS hardware model in the platform slot":
      "Mozilla/5.0 (iPhone13,2; U; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) Version/10.0 Mobile/15E148 Safari/602.1",
    "Safari newer than the iOS carrying it":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
  };

  for (const [label, ua] of Object.entries(spoofed)) {
    test(`sent: ${label}`, () => {
      expect(looksAutomated(ua)).toBe(true);
    });
  }

  const real = {
    "legacy Edge, which did ship beside Chrome 64":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/18.17763",
    "Chromium Edge, which uses Edg/":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.2535.51",
    "Edge on Android":
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 EdgA/125.0.2535.51",
    "an old but consistent iOS Safari":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1",
    "a current iOS Safari, majors equal":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Mobile/15E148 Safari/604.1",
    "iOS Safari older than its system":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
    "Chrome on iOS, which sends no Version/ token":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_3_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/144.0.7559.95 Mobile/15E148 Safari/604.1",
    "Firefox on iOS":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15",
    "iPad, whose platform string omits the word iPhone":
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "desktop Chrome on macOS":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    "desktop Firefox on Windows":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
    "Chrome on Android":
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
    "an in-app webview on iOS":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0;]",
  };

  for (const [label, ua] of Object.entries(real)) {
    test(`not sent: ${label}`, () => {
      expect(looksAutomated(ua)).toBe(false);
    });
  }
});

describe("isPageRequest", () => {
  test("GET and HEAD pages count, other methods do not", () => {
    expect(isPageRequest({ method: "GET", path: "/" })).toBe(true);
    expect(isPageRequest({ method: "head", path: "/about" })).toBe(true);
    expect(isPageRequest({ method: "POST", path: "/about" })).toBe(false);
    expect(isPageRequest({ method: "OPTIONS", path: "/" })).toBe(false);
  });

  test("crawler files always count, whatever the content type", () => {
    for (const path of [
      "/robots.txt",
      "/llms.txt",
      "/llms-full.txt",
      "/sitemap.xml",
      "/sitemap_index.xml",
      "/blog/post-sitemap.xml",
      "/sitemap-1.xml.gz",
    ]) {
      expect(isPageRequest({ method: "GET", path, contentType: "text/plain" })).toBe(true);
    }
  });

  test("assets are ignored", () => {
    for (const path of [
      "/app.js",
      "/style.css",
      "/logo.png",
      "/font.woff2",
      "/data.json",
      "/favicon.ico",
    ]) {
      expect(isPageRequest({ method: "GET", path })).toBe(false);
    }
  });

  test("page extensions count", () => {
    for (const path of ["/index.html", "/a.htm", "/b.php", "/c.aspx"]) {
      expect(isPageRequest({ method: "GET", path })).toBe(true);
    }
  });

  test("pages whose last segment merely contains a dot count", () => {
    for (const path of ["/user/john.doe", "/docs/v1.2", "/release/2.0.1"]) {
      expect(isPageRequest({ method: "GET", path })).toBe(true);
    }
  });

  test("redirects count whatever their content type", () => {
    expect(
      isPageRequest({ method: "GET", path: "/old", status: 301, contentType: "text/plain" }),
    ).toBe(true);
    expect(
      isPageRequest({ method: "GET", path: "/x", status: 200, contentType: "text/plain" }),
    ).toBe(false);
    expect(isPageRequest({ method: "GET", path: "/app.js", status: 302 })).toBe(false);
  });

  test("built-in API and framework paths are ignored", () => {
    expect(isPageRequest({ method: "GET", path: "/api" })).toBe(false);
    expect(isPageRequest({ method: "GET", path: "/api/users" })).toBe(false);
    expect(isPageRequest({ method: "GET", path: "/graphql" })).toBe(false);
    expect(isPageRequest({ method: "GET", path: "/_next/data/x.json" })).toBe(false);
    expect(isPageRequest({ method: "GET", path: "/apiary" })).toBe(true);
  });

  test("health endpoints are ignored, pages that merely start with them are not", () => {
    for (const path of ["/health", "/healthz", "/livez", "/readyz/", "/ping", "/HEALTHZ"]) {
      expect(isPageRequest({ method: "GET", path })).toBe(false);
    }
    for (const path of ["/healthcare", "/health/plans", "/pings", "/ping-pong"]) {
      expect(isPageRequest({ method: "GET", path })).toBe(true);
    }
  });

  test("custom ignorePaths accept prefixes and regular expressions", () => {
    const options = { ignorePaths: ["/admin", /^\/internal-/] };
    expect(isPageRequest({ method: "GET", path: "/admin/users" }, options)).toBe(false);
    expect(isPageRequest({ method: "GET", path: "/internal-report" }, options)).toBe(false);
    expect(isPageRequest({ method: "GET", path: "/pricing" }, options)).toBe(true);
  });

  test("a known non-HTML content type excludes the response", () => {
    expect(isPageRequest({ method: "GET", path: "/feed", contentType: "application/json" })).toBe(
      false,
    );
    expect(
      isPageRequest({ method: "GET", path: "/", contentType: "text/html; charset=utf-8" }),
    ).toBe(true);
    expect(isPageRequest({ method: "GET", path: "/", contentType: "application/xhtml+xml" })).toBe(
      true,
    );
    expect(isPageRequest({ method: "GET", path: "/moved", contentType: null })).toBe(true);
  });

  test("query strings and fragments do not affect the decision", () => {
    expect(isPageRequest({ method: "GET", path: "/robots.txt?x=1" })).toBe(true);
    expect(isPageRequest({ method: "GET", path: "/app.js?v=3" })).toBe(false);
    expect(isPageRequest({ method: "GET", path: "/page?file=a.png" })).toBe(true);
  });
});
