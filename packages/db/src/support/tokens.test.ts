import { describe, expect, it } from "vitest";
import { hashLinkToken, newLinkToken } from "./tokens";

describe("link tokens", () => {
  it("makes unguessable tokens and stores only their hash", () => {
    const a = newLinkToken();
    const b = newLinkToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkToken(a.token)).toBe(a.hash);
    expect(a.token).not.toBe(b.token);
  });
});
