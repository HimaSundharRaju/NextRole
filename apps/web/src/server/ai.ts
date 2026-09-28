import "server-only";
import { getAi, type AiCallContext, type AiProvider, type UsageRecord } from "@gettargetrole/ai";
import { QuotaExceededError } from "@gettargetrole/core/errors";
import { aiUsage, getDb } from "@gettargetrole/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { PLANS } from "@/lib/plans";
import type { SessionUser } from "./session";

export function startOfMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function monthlyAiSpendMicroUsd(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, startOfMonth())));
  return Number(row?.total ?? 0);
}

async function recordUsage(userId: string, record: UsageRecord): Promise<void> {
  await getDb()
    .insert(aiUsage)
    .values({ userId, ...record });
}

/**
 * Returns the AI provider plus a call context that meters usage for `user`, after checking the
 * user still has budget left this month on their plan.
 */
export async function aiFor(user: SessionUser): Promise<{ ai: AiProvider; ctx: AiCallContext }> {
  const budgetMicroUsd = PLANS[user.plan].monthlyAiBudgetUsd * 1_000_000;
  if ((await monthlyAiSpendMicroUsd(user.id)) >= budgetMicroUsd) {
    throw new QuotaExceededError();
  }
  return {
    ai: getAi(),
    ctx: { userId: user.id, onUsage: (record) => recordUsage(user.id, record) },
  };
}
