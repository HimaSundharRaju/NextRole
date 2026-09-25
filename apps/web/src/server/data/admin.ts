import "server-only";
import {
  aiUsage,
  applications,
  auditLogs,
  companies,
  getDb,
  jobs,
  specialistAssignments,
  users,
} from "@gettargetrole/db";
import { and, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
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

export async function isAssignedSpecialist(
  specialistId: string,
  clientId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ clientId: specialistAssignments.clientId })
    .from(specialistAssignments)
    .where(
      and(
        eq(specialistAssignments.specialistId, specialistId),
        eq(specialistAssignments.clientId, clientId),
        eq(specialistAssignments.active, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function clientsOf(specialistId: string) {
  return getDb()
    .select({ id: users.id, name: users.name, email: users.email, plan: users.plan })
    .from(specialistAssignments)
    .innerJoin(users, eq(specialistAssignments.clientId, users.id))
    .where(
      and(
        eq(specialistAssignments.specialistId, specialistId),
        eq(specialistAssignments.active, true),
      ),
    )
    .orderBy(users.name);
}
