import "server-only";
import { vendorOf } from "@gettargetrole/ai";
import {
  aiBatchRequests,
  aiUsage,
  applications,
  auditLogs,
  companies,
  companyRequests,
  getDb,
  jobs,
  specialistAssignments,
  users,
} from "@gettargetrole/db";
import { and, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import { PLANS } from "@/lib/plans";
import { startOfMonth } from "../ai";

export async function platformStats() {
  const db = getDb();
  const [[userCount], [jobCount], [newJobs], [companyCount], [spend], [applied]] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(isNull(jobs.closedAt)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(gte(jobs.firstSeenAt, new Date(Date.now() - 86_400_000))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(companies)
        .where(eq(companies.active, true)),
      db
        .select({ total: sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)` })
        .from(aiUsage)
        .where(gte(aiUsage.createdAt, startOfMonth())),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(applications)
        .where(gte(applications.appliedAt, new Date(Date.now() - 7 * 86_400_000))),
    ]);
  return {
    users: userCount?.count ?? 0,
    openJobs: jobCount?.count ?? 0,
    newJobs24h: newJobs?.count ?? 0,
    activeCompanies: companyCount?.count ?? 0,
    aiSpendUsdThisMonth: Number(spend?.total ?? 0) / 1_000_000,
    applicationsThisWeek: applied?.count ?? 0,
  };
}

export async function listCompanies() {
  return getDb().select().from(companies).orderBy(companies.name);
}

export async function searchUsers(query: string | undefined, limit = 50) {
  const db = getDb();
  const where = query
    ? or(
        ilike(users.email, `%${query.replace(/[%_]/g, "")}%`),
        ilike(users.name, `%${query.replace(/[%_]/g, "")}%`),
      )
    : undefined;
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      plan: users.plan,
      banned: users.banned,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

export async function recentAuditLogs(limit = 50) {
  return getDb()
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      ipAddress: auditLogs.ipAddress,
      createdAt: auditLogs.createdAt,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function listAssignments() {
  const db = getDb();
  const specialists = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.role, "specialist"));
  const rows = await db
    .select({
      specialistId: specialistAssignments.specialistId,
      clientId: specialistAssignments.clientId,
      active: specialistAssignments.active,
      clientEmail: users.email,
      clientName: users.name,
    })
    .from(specialistAssignments)
    .innerJoin(users, eq(specialistAssignments.clientId, users.id))
    .where(eq(specialistAssignments.active, true));
  return { specialists, assignments: rows };
}

const usd = (micro: string | number | null | undefined) => Number(micro ?? 0) / 1_000_000;

/**
 * This month's AI spend (UTC) broken down for cost control: by feature and model, how much input
 * came from the prompt cache, what went through batches, the biggest spenders, and spend set
 * against what the plans bring in at list price.
 */
export async function aiUsageReport(now = new Date()) {
  const db = getDb();
  const thisMonth = gte(aiUsage.createdAt, startOfMonth(now));
  const cost = sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)`;
  const calls = sql<number>`count(*)::int`;
  const [features, models, spenders, plans, [waiting], [enrichment], [enrichSpend]] =
    await Promise.all([
      db
        .select({
          feature: aiUsage.feature,
          calls,
          cost,
          batchCalls: sql<number>`(count(*) filter (where ${aiUsage.batch}))::int`,
        })
        .from(aiUsage)
        .where(thisMonth)
        .groupBy(aiUsage.feature)
        .orderBy(desc(cost)),
      db
        .select({
          model: aiUsage.model,
          calls,
          cost,
          batchCost: sql<string>`coalesce(sum(${aiUsage.costMicroUsd}) filter (where ${aiUsage.batch}), 0)`,
          inputTokens: sql<string>`coalesce(sum(${aiUsage.inputTokens}), 0)`,
          outputTokens: sql<string>`coalesce(sum(${aiUsage.outputTokens}), 0)`,
          cacheReadTokens: sql<string>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)`,
          cacheWriteTokens: sql<string>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)`,
        })
        .from(aiUsage)
        .where(thisMonth)
        .groupBy(aiUsage.model)
        .orderBy(desc(cost)),
      db
        .select({ id: users.id, name: users.name, email: users.email, plan: users.plan, cost })
        .from(aiUsage)
        .innerJoin(users, eq(aiUsage.userId, users.id))
        .where(thisMonth)
        .groupBy(users.id)
        .orderBy(desc(cost))
        .limit(10),
      db.select({ plan: users.plan, count: calls }).from(users).groupBy(users.plan),
      db
        .select({ count: calls })
        .from(aiBatchRequests)
        .where(sql`${aiBatchRequests.status} in ('queued', 'submitted')`),
      db
        .select({
          open: calls,
          enriched: sql<number>`(count(*) filter (where ${jobs.enrichedHash} = ${jobs.contentHash}))::int`,
          waiting: sql<number>`(count(*) filter (where ${jobs.enrichmentBatchId} is not null))::int`,
        })
        .from(jobs)
        .where(isNull(jobs.closedAt)),
      db
        .select({ total: cost })
        .from(aiUsage)
        .where(
          and(
            eq(aiUsage.feature, "enrich"),
            gte(aiUsage.createdAt, new Date(now.getTime() - 86_400_000)),
          ),
        ),
    ]);

  const byModel = models.map((row) => {
    const input =
      Number(row.inputTokens) + Number(row.cacheReadTokens) + Number(row.cacheWriteTokens);
    return {
      model: row.model,
      vendor: vendorOf(row.model),
      calls: row.calls,
      spendUsd: usd(row.cost),
      batchSpendUsd: usd(row.batchCost),
      inputTokens: input,
      outputTokens: Number(row.outputTokens),
      cacheReadTokens: Number(row.cacheReadTokens),
    };
  });
  const spendUsd = byModel.reduce((total, row) => total + row.spendUsd, 0);
  const batchSpendUsd = byModel.reduce((total, row) => total + row.batchSpendUsd, 0);
  const inputTokens = byModel.reduce((total, row) => total + row.inputTokens, 0);
  const cacheReadTokens = byModel.reduce((total, row) => total + row.cacheReadTokens, 0);
  const planRevenueUsd = plans.reduce(
    (total, row) => total + row.count * PLANS[row.plan].priceUsd,
    0,
  );

  return {
    spendUsd,
    calls: byModel.reduce((total, row) => total + row.calls, 0),
    /** Share of input tokens read from the prompt cache (billed at a tenth or less). */
    cacheReadShare: inputTokens > 0 ? cacheReadTokens / inputTokens : 0,
    /** Batches bill half price, so the same work at list price would have cost twice as much. */
    batchSavingsUsd: batchSpendUsd,
    batchShare: spendUsd > 0 ? batchSpendUsd / spendUsd : 0,
    waitingInBatches: waiting?.count ?? 0,
    /** Open posts job enrichment has read as they are, and its spend in the last day. */
    enrichment: {
      open: enrichment?.open ?? 0,
      enriched: enrichment?.enriched ?? 0,
      waiting: enrichment?.waiting ?? 0,
      spentTodayUsd: usd(enrichSpend?.total),
    },
    planRevenueUsd,
    byFeature: features.map((row) => ({
      feature: row.feature,
      calls: row.calls,
      spendUsd: usd(row.cost),
      perCallUsd: row.calls > 0 ? usd(row.cost) / row.calls : 0,
      batchCalls: row.batchCalls,
    })),
    byModel,
    topSpenders: spenders.map((row) => ({
      ...row,
      spendUsd: usd(row.cost),
      capShare: usd(row.cost) / PLANS[row.plan].monthlyAiBudgetUsd,
    })),
  };
}

/**
 * Company requests: how many are in each state, and the latest ones people made or that found
 * no board (YC's pending ones are left out; there can be hundreds).
 */
export async function companyRequestReport(limit = 50) {
  const db = getDb();
  const [counts, rows] = await Promise.all([
    db
      .select({ status: companyRequests.status, count: sql<number>`count(*)::int` })
      .from(companyRequests)
      .groupBy(companyRequests.status),
    db
      .select({
        id: companyRequests.id,
        source: companyRequests.source,
        name: companyRequests.name,
        url: companyRequests.url,
        status: companyRequests.status,
        note: companyRequests.note,
        createdAt: companyRequests.createdAt,
        userEmail: users.email,
        companyName: companies.name,
      })
      .from(companyRequests)
      .leftJoin(users, eq(companyRequests.userId, users.id))
      .leftJoin(companies, eq(companyRequests.companyId, companies.id))
      .where(or(sql`${companyRequests.source} <> 'yc'`, eq(companyRequests.status, "not_found")))
      .orderBy(desc(companyRequests.createdAt))
      .limit(limit),
  ]);
  return {
    counts: Object.fromEntries(counts.map((row) => [row.status, row.count])) as Partial<
      Record<(typeof rows)[number]["status"], number>
    >,
    rows,
  };
}
