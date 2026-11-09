import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const headers = (forwarded: string, real?: string) =>
  new Headers({ "x-forwarded-for": forwarded, ...(real ? { "x-real-ip": real } : {}) });

describe("clientIp", () => {
  it("uses the rightmost address that isn't a trusted proxy", () => {
    expect(clientIp(headers("203.0.113.9, 10.0.0.5"), ["10.0.0.0/8"])).toBe("203.0.113.9");
    expect(clientIp(headers("1.1.1.1, 203.0.113.9"), [])).toBe("203.0.113.9"); // a spoofed leftmost entry is ignored
    expect(clientIp(headers("2001:db8::1, 192.0.2.1"), ["192.0.2.1"])).toBe("2001:db8::1");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.7" }), [])).toBe("198.51.100.7");
    expect(clientIp(new Headers(), [])).toBe("unknown");
  });

  it("trusts IPv6 proxies by address or by range, and tolerates spaces", () => {
    expect(clientIp(headers("198.51.100.2 ,  2001:db8::5"), ["2001:db8::/32"])).toBe(
      "198.51.100.2",
    );
    expect(clientIp(headers("198.51.100.2, 2001:db8::5"), ["2001:db8::5"])).toBe("198.51.100.2");
  });

  it("ignores malformed proxy entries instead of failing", () => {
    expect(
      clientIp(headers("203.0.113.9, 10.0.0.5"), ["not-a-range", "10.0.0.0/99", "10.0.0.0/8"]),
    ).toBe("203.0.113.9");
  });

  it("doesn't look past an entry that isn't an address, or past a chain of trusted proxies", () => {
    // A bad entry on the right means the chain can't be trusted; fall back to X-Real-IP.
    expect(clientIp(headers("203.0.113.9, garbage", "198.51.100.7"), [])).toBe("198.51.100.7");
    expect(clientIp(headers("203.0.113.9, garbage"), [])).toBe("unknown");
    expect(clientIp(headers("10.0.0.5, 10.0.0.6"), ["10.0.0.0/8"])).toBe("unknown");
    expect(clientIp(headers("", "not-an-ip"), [])).toBe("unknown");
  });
});
