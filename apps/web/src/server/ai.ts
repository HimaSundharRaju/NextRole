import "server-only";
import { getAi, type AiCallContext, type AiProvider } from "@gettargetrole/ai";
import { QuotaExceededError } from "@gettargetrole/core/errors";
import {
  hasAiBudget,
  monthlyUnits,
  PLAN_LIMITS,
  recordAiUsage,
  recordUsageEvent,
  type UsageUnit,
} from "@gettargetrole/db";
import { limitMessage } from "@/lib/plans";
import type { SessionUser } from "./session";

export { monthlyAiSpendMicroUsd, monthlyUsage, startOfMonth } from "@gettargetrole/db";

export interface MeteredAi {
  ai: AiProvider;
  ctx: AiCallContext;
  /** Counts one `unit` against the user's plan. Call it once the new result is saved. */
  charge: (ref?: string) => Promise<void>;
}

/**
 * Returns the AI provider plus a call context that meters token spend for `user`, after checking
 * that their plan includes `unit`, that they have some left this month, and that their spend is
 * under the plan's cap.
 */
export async function aiFor(user: SessionUser, unit: UsageUnit): Promise<MeteredAi> {
  if ((await monthlyUnits(user.id, unit)) >= PLAN_LIMITS[user.plan][unit]) {
    throw new QuotaExceededError(limitMessage(user.plan, unit));
  }
  if (!(await hasAiBudget(user.id, user.plan))) throw new QuotaExceededError();
  return {
    ai: getAi(),
    ctx: { userId: user.id, onUsage: (record) => recordAiUsage(user.id, record) },
    charge: (ref = "") => recordUsageEvent(user.id, unit, ref),
  };
}
