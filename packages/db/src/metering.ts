import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./client";
import { MONTHLY_AI_BUDGET_USD } from "./plans";
import { aiUsage } from "./schema/app";
import type { Plan } from "./schema/auth";

export type AiUsageRow = Omit<typeof aiUsage.$inferInsert, "id" | "userId" | "createdAt">;

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

/** Whether the user has budget left this month on their plan. */
export async function hasAiBudget(userId: string, plan: Plan): Promise<boolean> {
  return (await monthlyAiSpendMicroUsd(userId)) < MONTHLY_AI_BUDGET_USD[plan] * 1_000_000;
}

export async function recordAiUsage(userId: string, record: AiUsageRow): Promise<void> {
  await getDb()
    .insert(aiUsage)
    .values({ userId, ...record });
}
