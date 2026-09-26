import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "./client";
import { startOfMonth } from "./metering";
import { USAGE_UNITS, type UsageUnit } from "./plans";
import { usageEvents } from "./schema/app";

export type MonthlyUsage = Record<UsageUnit, number>;

/** Units the user has spent this calendar month (UTC), for every unit. */
export async function monthlyUsage(userId: string, now = new Date()): Promise<MonthlyUsage> {
  const rows = await getDb()
    .select({ unit: usageEvents.unit, count: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, startOfMonth(now))))
    .groupBy(usageEvents.unit);
  const usage = Object.fromEntries(USAGE_UNITS.map((unit) => [unit, 0])) as MonthlyUsage;
  for (const row of rows) usage[row.unit] = row.count;
  return usage;
}

/** Units of one kind the user has spent this calendar month (UTC). */
export async function monthlyUnits(
  userId: string,
  unit: UsageUnit,
  now = new Date(),
): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.unit, unit),
        gte(usageEvents.createdAt, startOfMonth(now)),
      ),
    );
  return row?.count ?? 0;
}

export async function recordUsageEvent(userId: string, unit: UsageUnit, ref = ""): Promise<void> {
  await getDb().insert(usageEvents).values({ userId, unit, ref });
}
