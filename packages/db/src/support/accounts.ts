import { and, desc, eq, gt, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  applications,
  auditLogs,
  exportLinks,
  resumes,
  ROLES,
  supportCases,
  users,
  type ApplicationStatus,
  type Plan,
  type Role,
} from "../schema";
import { EXPORT_LINK_HOURS } from "./rules";
import { hashLinkToken, newLinkToken } from "./tokens";

const HOUR_MS = 3_600_000;

export interface AccountSummary {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  plan: Plan;
  role: Role;
  createdAt: Date;
  banned: boolean;
  banReason: string | null;
  /** The newest `auth.sign_in` audit entry for the account. */
  lastSignInAt: Date | null;
  applicationsByStatus: Partial<Record<ApplicationStatus, number>>;
  resumes: number;
  openCases: number;
  solvedCases: number;
}

/** What an agent sees at the top of an account page: no resume, letter or answer text. */
export async function accountSummary(db: Database, userId: string): Promise<AccountSummary | null> {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      plan: users.plan,
      role: users.role,
      createdAt: users.createdAt,
      banned: users.banned,
      banReason: users.banReason,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  const [byStatus, [resumeCount], [caseCounts], [signIn]] = await Promise.all([
    db
      .select({ status: applications.status, count: sql<number>`count(*)::int` })
      .from(applications)
      .where(eq(applications.userId, userId))
      .groupBy(applications.status),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(resumes)
      .where(eq(resumes.userId, userId)),
    db
      .select({
        open: sql<number>`(count(*) filter (where ${supportCases.status} <> 'solved'))::int`,
        solved: sql<number>`(count(*) filter (where ${supportCases.status} = 'solved'))::int`,
      })
      .from(supportCases)
      .where(eq(supportCases.userId, userId)),
    db
      .select({ at: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.actorUserId, userId), eq(auditLogs.action, "auth.sign_in")))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1),
  ]);
  return {
    ...user,
    // Better Auth's `role` is free text; anything it doesn't know is a plain user.
    role: (ROLES as readonly string[]).includes(user.role) ? (user.role as Role) : "user",
    banned: Boolean(user.banned),
    lastSignInAt: signIn?.at ?? null,
    applicationsByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row.count])),
    resumes: resumeCount!.count,
    openCases: caseCounts!.open,
    solvedCases: caseCounts!.solved,
  };
}

/** The audit entries where the account acted or was acted on, newest first. */
export async function accountActivity(
  db: Database,
  userId: string,
  limit = 20,
): Promise<Array<{ action: string; createdAt: Date; actorEmail: string | null }>> {
  return db
    .select({
      action: auditLogs.action,
      createdAt: auditLogs.createdAt,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(or(eq(auditLogs.actorUserId, userId), eq(auditLogs.targetId, userId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

/**
 * Whether an agent may delete this account for this case: only an open, verified "My data" help
 * request that is about this account. Typing an email into the signed-out form proves nothing.
 */
export async function deletableForCase(
  db: Database,
  input: { userId: string; caseId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: supportCases.id })
    .from(supportCases)
    .where(
      and(
        eq(supportCases.id, input.caseId),
        eq(supportCases.userId, input.userId),
        eq(supportCases.kind, "help"),
        eq(supportCases.topic, "data"),
        isNotNull(supportCases.verifiedAt),
        ne(supportCases.status, "solved"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** A single-use link, valid for 24 hours, that downloads the account's data. Returns its token. */
export async function createExportLink(
  db: Database,
  input: { userId: string; createdBy: string; now?: Date },
): Promise<string> {
  const now = input.now ?? new Date();
  const { token, hash } = newLinkToken();
  await db.insert(exportLinks).values({
    userId: input.userId,
    tokenHash: hash,
    createdByUserId: input.createdBy,
    expiresAt: new Date(now.getTime() + EXPORT_LINK_HOURS * HOUR_MS),
    createdAt: now,
  });
  return token;
}

/** Whether a link can still be used. Looking doesn't use it up, so mail scanners are harmless. */
export async function exportLinkUsable(
  db: Database,
  token: string,
  now = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({ id: exportLinks.id })
    .from(exportLinks)
    .where(
      and(
        eq(exportLinks.tokenHash, hashLinkToken(token)),
        isNull(exportLinks.usedAt),
        gt(exportLinks.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Uses the link up and returns whose data it unlocks; null if it was used, expired or unknown. */
export async function redeemExportLink(
  db: Database,
  token: string,
  now = new Date(),
): Promise<string | null> {
  const [row] = await db
    .update(exportLinks)
    .set({ usedAt: now })
    .where(
      and(
        eq(exportLinks.tokenHash, hashLinkToken(token)),
        isNull(exportLinks.usedAt),
        gt(exportLinks.expiresAt, now),
      ),
    )
    .returning({ userId: exportLinks.userId });
  return row?.userId ?? null;
}
