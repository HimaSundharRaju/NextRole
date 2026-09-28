import "server-only";
import { getAi, type AiCallContext, type AiProvider } from "@gettargetrole/ai";
import { QuotaExceededError } from "@gettargetrole/core/errors";
import { hasAiBudget, recordAiUsage } from "@gettargetrole/db";
import type { SessionUser } from "./session";

export { monthlyAiSpendMicroUsd, startOfMonth } from "@gettargetrole/db";

/**
 * Returns the AI provider plus a call context that meters usage for `user`, after checking the
 * user still has budget left this month on their plan.
 */
export async function aiFor(user: SessionUser): Promise<{ ai: AiProvider; ctx: AiCallContext }> {
  if (!(await hasAiBudget(user.id, user.plan))) throw new QuotaExceededError();
  return {
    ai: getAi(),
    ctx: { userId: user.id, onUsage: (record) => recordAiUsage(user.id, record) },
  };
}
