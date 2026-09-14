import { describe, expect, test } from "bun:test";
import { normalizeIp, resolveClientIp } from "../src/ip.js";

describe("normalizeIp", () => {
  test("accepts IPv4 and IPv6 literals", () => {
    expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp(" 2001:DB8::1 ")).toBe("2001:db8::1");
  });

  test("strips ports, brackets, quotes, zones and the IPv4-mapped prefix", () => {
    expect(normalizeIp("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp('"203.0.113.7"')).toBe("203.0.113.7");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("rejects anything that is not an address", () => {
    expect(normalizeIp("unknown")).toBeNull();
    expect(normalizeIp("_hidden")).toBeNull();
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });

  test("rejects out-of-range octets and degenerate IPv6", () => {
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("256.0.0.1")).toBeNull();
    expect(normalizeIp(":")).toBeNull();
    expect(normalizeIp("::")).toBeNull();
    expect(normalizeIp("1::2::3")).toBeNull();
    expect(normalizeIp("::1")).toBe("::1");
    expect(normalizeIp("2001:db8::10.0.0.1")).toBe("2001:db8::10.0.0.1");
  });
});

describe("resolveClientIp", () => {
  const headers = {
    "x-forwarded-for": "198.51.100.1, 198.51.100.2, 10.0.0.5",
    "cf-connecting-ip": "192.0.2.44",
  };
  const request = { headers, remoteAddress: "10.0.0.9" };

  test("ignores forwarding headers unless a proxy is trusted", () => {
    expect(resolveClientIp(request, { trustProxy: false })).toBe("10.0.0.9");
    expect(resolveClientIp(request, { trustProxy: false, ipHeader: "cf-connecting-ip" })).toBe(
      "10.0.0.9",
    );
  });

  test("trustProxy as a hop count picks from the right", () => {
    expect(resolveClientIp(request, { trustProxy: 1 })).toBe("10.0.0.5");
    expect(resolveClientIp(request, { trustProxy: 2 })).toBe("198.51.100.2");
    expect(resolveClientIp(request, { trustProxy: 3 })).toBe("198.51.100.1");
    expect(resolveClientIp(request, { trustProxy: 9 })).toBe("198.51.100.1");
  });

  test("trustProxy true takes the leftmost entry", () => {
    expect(resolveClientIp(request, { trustProxy: true })).toBe("198.51.100.1");
  });

  test("a missing ipHeader falls back to the socket, never to X-Forwarded-For", () => {
    const forged = {
      headers: { "x-forwarded-for": "6.6.6.6, 10.0.0.1" },
      remoteAddress: "10.0.0.9",
    };
    expect(resolveClientIp(forged, { trustProxy: true, ipHeader: "cf-connecting-ip" })).toBe(
      "10.0.0.9",
    );
    expect(resolveClientIp(forged, { trustProxy: 1, ipHeader: "x-real-ip" })).toBe("10.0.0.9");
  });

  test("a trusted ipHeader wins over X-Forwarded-For", () => {
    expect(resolveClientIp(request, { trustProxy: true, ipHeader: "cf-connecting-ip" })).toBe(
      "192.0.2.44",
    );
  });

  test("falls back to the socket when headers are missing or unusable", () => {
    expect(resolveClientIp({ headers: {}, remoteAddress: "10.0.0.9" }, { trustProxy: 1 })).toBe(
      "10.0.0.9",
    );
    expect(
      resolveClientIp(
        { headers: { "x-forwarded-for": "unknown" }, remoteAddress: "::ffff:10.0.0.9" },
        { trustProxy: 1 },
      ),
    ).toBe("10.0.0.9");
    expect(resolveClientIp({ headers: {} }, { trustProxy: false })).toBeNull();
  });

  test("works with WHATWG Headers", () => {
    const h = new Headers({ "X-Forwarded-For": "198.51.100.1" });
    expect(resolveClientIp({ headers: h, remoteAddress: null }, { trustProxy: 1 })).toBe(
      "198.51.100.1",
    );
  });
});
