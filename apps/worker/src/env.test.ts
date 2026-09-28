import { describe, expect, it } from "vitest";
import { aiConfigured, loadWorkerEnv } from "./env";

describe("worker env", () => {
  const base = { DATABASE_URL: "postgres://localhost/test" };

  it("turns auto-prepare on only when the AI can be called", () => {
    expect(aiConfigured(loadWorkerEnv(base))).toBe(false);
    expect(aiConfigured(loadWorkerEnv({ ...base, ANTHROPIC_API_KEY: "key" }))).toBe(true);
    expect(aiConfigured(loadWorkerEnv({ ...base, AI_PROVIDER: "mock" }))).toBe(true);
  });

  it("rejects an unknown AI provider", () => {
    expect(() => loadWorkerEnv({ ...base, AI_PROVIDER: "other" })).toThrow("AI_PROVIDER");
  });
});
