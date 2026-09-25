import "server-only";
import {
  aiUsage,
  applicationEvents,
  applications,
  getDb,
  jobMatches,
  notifications,
  outreachMessages,
  profiles,
  resumeMessages,
  resumes,
  users,
} from "@gettargetrole/db";
import { eq, inArray } from "drizzle-orm";

/** Everything GetTargetRole stores about a user, for data portability requests. */
export async function exportUserData(userId: string) {
  const db = getDb();
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      plan: users.plan,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
  const resumeRows = await db.select().from(resumes).where(eq(resumes.userId, userId));
  const resumeIds = resumeRows.map((row) => row.id);
  const appRows = await db.select().from(applications).where(eq(applications.userId, userId));
  const appIds = appRows.map((row) => row.id);

  return {
    exportedAt: new Date().toISOString(),
    user,
    profile,
    resumes: resumeRows,
    resumeChat: resumeIds.length
      ? await db.select().from(resumeMessages).where(inArray(resumeMessages.resumeId, resumeIds))
      : [],
    applications: appRows,
    applicationEvents: appIds.length
      ? await db
          .select()
          .from(applicationEvents)
          .where(inArray(applicationEvents.applicationId, appIds))
      : [],
    outreach: await db.select().from(outreachMessages).where(eq(outreachMessages.userId, userId)),
    jobMatches: await db.select().from(jobMatches).where(eq(jobMatches.userId, userId)),
    notifications: await db.select().from(notifications).where(eq(notifications.userId, userId)),
    aiUsage: await db
      .select({ feature: aiUsage.feature, model: aiUsage.model, createdAt: aiUsage.createdAt })
      .from(aiUsage)
      .where(eq(aiUsage.userId, userId)),
  };
}

/** Deletes the account; all user-owned rows cascade from the users table. */
export async function deleteUserAccount(userId: string): Promise<void> {
  await getDb().delete(users).where(eq(users.id, userId));
}
