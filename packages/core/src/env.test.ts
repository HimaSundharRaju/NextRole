import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "./env";

const valid = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pass@localhost:5432/nextrole",
  BETTER_AUTH_SECRET: "x".repeat(40),
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

describe("serverEnvSchema", () => {
  it("accepts a minimal production config and applies defaults", () => {
    const env = serverEnvSchema.parse(valid);
    expect(env.AI_PROVIDER).toBe("anthropic");
    expect(env.AI_MODEL).toBe("claude-opus-5");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
  });

  it("parses trusted proxies as a list", () => {
    expect(serverEnvSchema.parse(valid).TRUSTED_PROXIES).toEqual([]);
    const env = serverEnvSchema.parse({ ...valid, TRUSTED_PROXIES: " 10.0.0.0/8, 192.0.2.1 ," });
    expect(env.TRUSTED_PROXIES).toEqual(["10.0.0.0/8", "192.0.2.1"]);
  });

  it("refuses the mock AI provider in production", () => {
    const result = serverEnvSchema.safeParse({ ...valid, AI_PROVIDER: "mock" });
    expect(result.success).toBe(false);
  });

  it("requires a 32-byte encryption key", () => {
    const result = serverEnvSchema.safeParse({ ...valid, ENCRYPTION_KEY: "short" });
    expect(result.success).toBe(false);
  });

  it("requires OAuth credentials in pairs", () => {
    const result = serverEnvSchema.safeParse({ ...valid, GOOGLE_CLIENT_ID: "id-only" });
    expect(result.success).toBe(false);
  });
});
