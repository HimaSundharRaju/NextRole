import type * as DbModule from "@gettargetrole/db";
import { ensureTestDatabase, testDatabaseUrl } from "@gettargetrole/db/test-database";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as ConciergeModule from "./concierge";

const TEST_DATABASE_URL = testDatabaseUrl("worker");

describe.skipIf(!TEST_DATABASE_URL)("Concierge daily digest (Postgres integration)", () => {
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let concierge: typeof ConciergeModule;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    concierge = await import("./concierge");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(drizzle.sql`TRUNCATE users, companies RESTART IDENTITY CASCADE`);
    await database
      .insert(db.users)
      .values({ id: "client-1", name: "Riya", email: "riya@example.com", plan: "concierge" });
    await database.insert(db.applications).values({
      userId: "client-1",
      companyName: "Acme",
      jobTitle: "Engineer",
      status: "proposed",
      proposedAt: new Date("2026-09-30T08:00:00Z"),
    });
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  it("sends one digest per client per day for new proposals", async () => {
    const now = new Date("2026-09-30T14:00:00Z");
    expect(await concierge.sendConciergeDigests(now)).toBe(1);
    expect(await concierge.sendConciergeDigests(now)).toBe(0);
    const rows = await db.getDb().select().from(db.notifications);
    expect(rows).toEqual([
      expect.objectContaining({
        userId: "client-1",
        type: "concierge",
        dedupeKey: "digest:2026-09-30",
      }),
    ]);
  });
});
