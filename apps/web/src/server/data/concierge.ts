import "server-only";
import { applicationEvents, applications, getDb, profiles, users } from "@gettargetrole/db";
import { desc, eq } from "drizzle-orm";

/** A client's recent timeline across applications, including staff notes (staff only). */
export async function clientTimeline(clientId: string, limit = 100) {
  return getDb()
    .select({
      id: applicationEvents.id,
      type: applicationEvents.type,
      data: applicationEvents.data,
      createdAt: applicationEvents.createdAt,
      actorName: users.name,
      jobTitle: applications.jobTitle,
      companyName: applications.companyName,
      applicationId: applications.id,
    })
    .from(applicationEvents)
    .innerJoin(applications, eq(applications.id, applicationEvents.applicationId))
    .leftJoin(users, eq(users.id, applicationEvents.actorUserId))
    .where(eq(applications.userId, clientId))
    .orderBy(desc(applicationEvents.createdAt))
    .limit(limit);
}

export async function clientSetup(clientId: string) {
  const [row] = await getDb()
    .select({
      jobSearchEmail: profiles.jobSearchEmail,
      consentAt: profiles.applyConsentAt,
      accessConfirmedAt: profiles.inboxAccessConfirmedAt,
      weeklyTargetOverride: profiles.weeklyTargetOverride,
      answerBank: profiles.answerBank,
    })
    .from(profiles)
    .where(eq(profiles.userId, clientId))
    .limit(1);
  return (
    row ?? {
      jobSearchEmail: "",
      consentAt: null,
      accessConfirmedAt: null,
      weeklyTargetOverride: null,
      answerBank: [],
    }
  );
}
