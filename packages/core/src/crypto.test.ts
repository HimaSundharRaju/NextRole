import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, safeEqual, sha256 } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips text", () => {
    const secret = "ya29.a0AfH6SM-refresh-token ✓";
    const encrypted = encryptSecret(secret, key);
    expect(encrypted.startsWith("v1:")).toBe(true);
    expect(encrypted).not.toContain(secret);
    expect(decryptSecret(encrypted, key)).toBe(secret);
  });

  it("uses a fresh IV per call", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptSecret("do not touch", key);
    const raw = Buffer.from(encrypted.slice(3), "base64");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptSecret(`v1:${raw.toString("base64")}`, key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const encrypted = encryptSecret("secret", key);
    expect(() => decryptSecret(encrypted, randomBytes(32).toString("base64"))).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptSecret("x", randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("helpers", () => {
  it("compares in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("hashes with sha256", () => {
    expect(sha256("nextrole")).toHaveLength(64);
  });
});
