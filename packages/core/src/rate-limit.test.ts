import { beforeEach, describe, expect, it } from "vitest";
import { RateLimitError } from "./errors";
import { enforceRateLimit, RATE_LIMIT_POLICIES, resetRateLimiters } from "./rate-limit";

describe("enforceRateLimit", () => {
  beforeEach(() => resetRateLimiters());

  it("allows requests up to the policy limit, then throws RateLimitError", async () => {
    const { points } = RATE_LIMIT_POLICIES.resumeImport;
    for (let i = 0; i < points; i++) {
      await enforceRateLimit("resumeImport", "user-1");
    }
    await expect(enforceRateLimit("resumeImport", "user-1")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("tracks identifiers independently", async () => {
    const { points } = RATE_LIMIT_POLICIES.resumeImport;
    for (let i = 0; i < points; i++) {
      await enforceRateLimit("resumeImport", "user-a");
    }
    await expect(enforceRateLimit("resumeImport", "user-b")).resolves.toBeUndefined();
  });
});
