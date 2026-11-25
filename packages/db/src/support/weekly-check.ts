import { and, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import { targetFor } from "../concierge/rules";
import {
  applications,
  conciergeWeekChecks,
  profiles,
  specialistAssignments,
  supportCases,
  users,
} from "../schema";
import { addNote, createCase } from "./cases";
import { previousWeek, weeklyCheckAction } from "./rules";

const formatDay = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The Monday check: each Concierge client who was assigned before last week began, isn't paused
 * and applied to fewer jobs than their target gets an escalation for customer care, or a note on
 * the one that's already open. `concierge_week_checks` makes a second run for the same week do
 * nothing, and each client's check is one transaction, so a failure can't mark a week checked.
 */
export async function runWeeklyCheck(
  db: Database,
  now = new Date(),
): Promise<{ opened: number; noted: number }> {
  const { start, end } = previousWeek(now);
  const clients = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      specialistId: specialistAssignments.specialistId,
      override: profiles.weeklyTargetOverride,
    })
    .from(specialistAssignments)
    .innerJoin(users, eq(users.id, specialistAssignments.clientId))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(specialistAssignments.active, true),
        lt(specialistAssignments.createdAt, start),
        eq(users.plan, "concierge"),
        isNull(profiles.conciergePausedAt),
      ),
    );
  if (clients.length === 0) return { opened: 0, noted: 0 };
  const counts = new Map(
    (
      await db
        .select({ userId: applications.userId, count: sql<number>`count(*)::int` })
        .from(applications)
        .where(
          and(
            inArray(
              applications.userId,
              clients.map((client) => client.id),
            ),
            gte(applications.appliedAt, start),
            lt(applications.appliedAt, end),
          ),
        )
        .groupBy(applications.userId)
    ).map((row) => [row.userId, row.count]),
  );
  const week = start.toISOString().slice(0, 10);
  let opened = 0;
  let noted = 0;
  for (const client of clients) {
    const applied = counts.get(client.id) ?? 0;
    const target = targetFor(client.override);
    const action = await db.transaction(async (tx) => {
      const [checked] = await tx
        .insert(conciergeWeekChecks)
        .values({ clientId: client.id, weekStart: week })
        .onConflictDoNothing()
        .returning({ clientId: conciergeWeekChecks.clientId });
      if (!checked) return "skip" as const;
      const [open] = await tx
        .select({ id: supportCases.id })
        .from(supportCases)
        .where(
          and(
            eq(supportCases.userId, client.id),
            eq(supportCases.kind, "escalation"),
            ne(supportCases.status, "solved"),
          ),
        )
        .orderBy(desc(supportCases.createdAt))
        .limit(1);
      const action = weeklyCheckAction({ applied, target, hasOpenEscalation: Boolean(open) });
      const text = `Missed the week of ${formatDay(start)}: ${applied} of ${target}`;
      if (action === "note") {
        await addNote(tx, {
          caseId: open!.id,
          authorId: null,
          body: text,
          authorKind: "system",
          now,
        });
      } else if (action === "open") {
        await createCase(tx, {
          kind: "escalation",
          source: "weekly_check",
          topic: "concierge",
          subject: `Missed weekly target: ${applied} of ${target}`,
          body: text,
          userId: client.id,
          contactName: client.name,
          contactEmail: client.email,
          raisedByUserId: null,
          specialistId: client.specialistId,
          verified: false,
          visibility: "internal",
          authorKind: "system",
          authorUserId: null,
          now,
        });
      }
      return action;
    });
    if (action === "open") opened++;
    else if (action === "note") noted++;
  }
  return { opened, noted };
}
