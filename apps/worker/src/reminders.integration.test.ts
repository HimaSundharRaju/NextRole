import type * as DbModule from "@nextrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as RemindersModule from "./reminders";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("follow-up reminders (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let reminders: typeof RemindersModule;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@nextrole/db/migrate");
    await runMigrations();
    db = await import("@nextrole/db");
    drizzle = await import("drizzle-orm");
    reminders = await import("./reminders");
    await db.getDb().execute(drizzle.sql`TRUNCATE users, notifications RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  it("reminds once for due, active applications only", async () => {
    const database = db.getDb();
    await database.insert(db.users).values({ id: "user-r", name: "Sam", email: "sam@example.com" });
    const yesterday = new Date(Date.now() - 86_400_000);
    const nextWeek = new Date(Date.now() + 7 * 86_400_000);
    await database.insert(db.applications).values([
      {
        userId: "user-r",
        companyName: "Acme",
        jobTitle: "Engineer",
        status: "applied",
        nextActionAt: yesterday,
      },
      {
        userId: "user-r",
        companyName: "Globex",
        jobTitle: "Engineer",
        status: "applied",
        nextActionAt: nextWeek,
      },
      {
        userId: "user-r",
        companyName: "Initech",
        jobTitle: "Engineer",
        status: "rejected",
        nextActionAt: yesterday,
      },
    ]);

    expect(await reminders.createFollowUpReminders()).toBe(1);
    expect(await reminders.createFollowUpReminders()).toBe(0);

    const [notification] = await database.select().from(db.notifications);
    expect(notification).toMatchObject({ type: "follow_up", title: "Follow up with Acme" });
  });
});
