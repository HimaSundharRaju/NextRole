import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
  type RateLimiterAbstract,
} from "rate-limiter-flexible";
import { RateLimitError } from "./errors";
import { getRedis } from "./redis";

export const RATE_LIMIT_POLICIES = {
  /** Expensive AI calls (tailoring, generation, analysis). */
  aiHeavy: { points: 40, duration: 60 * 60 },
  /** Interactive resume-studio chat turns. */
  aiChat: { points: 120, duration: 60 * 60 },
  /** Resume imports (file parsing + AI extraction). */
  resumeImport: { points: 20, duration: 60 * 60 },
  /** File exports (PDF / DOCX rendering). */
  export: { points: 120, duration: 60 * 60 },
  /** General authenticated mutations. */
  mutation: { points: 300, duration: 60 },
  /** Admin-triggered job board syncs. */
  adminSync: { points: 30, duration: 60 * 10 },
} as const;

export type RateLimitPolicy = keyof typeof RATE_LIMIT_POLICIES;

const limiters = new Map<RateLimitPolicy, RateLimiterAbstract>();

function useMemoryStore(): boolean {
  return process.env.NODE_ENV === "test" || process.env.RATE_LIMIT_STORE === "memory";
}

function limiterFor(policy: RateLimitPolicy): RateLimiterAbstract {
  let limiter = limiters.get(policy);
  if (limiter) return limiter;

  const { points, duration } = RATE_LIMIT_POLICIES[policy];
  const keyPrefix = `rl:${policy}`;
  // If Redis is unreachable we degrade to a per-process limit rather than failing open.
  const memory = new RateLimiterMemory({ keyPrefix, points, duration });
  limiter = useMemoryStore()
    ? memory
    : new RateLimiterRedis({
        storeClient: getRedis(),
        keyPrefix,
        points,
        duration,
        insuranceLimiter: memory,
      });
  limiters.set(policy, limiter);
  return limiter;
}

/** Consumes one point for `identifier` (usually a user id); throws RateLimitError when exhausted. */
export async function enforceRateLimit(
  policy: RateLimitPolicy,
  identifier: string,
  cost = 1,
): Promise<void> {
  try {
    await limiterFor(policy).consume(identifier, cost);
  } catch (error) {
    if (error instanceof RateLimiterRes) {
      throw new RateLimitError(error.msBeforeNext / 1000);
    }
    throw error;
  }
}

/** Test helper. */
export function resetRateLimiters(): void {
  limiters.clear();
}
