import type * as DbModule from "@nextrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as AlertsModule from "./alerts";
import type * as IngestModule from "./ingest";
import { fakeFetch, greenhouseResponse } from "./test-fixtures";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("job ingestion (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let ingest: typeof IngestModule;
  let alerts: typeof AlertsModule;
  let drizzle: typeof DrizzleModule;
  let companyId: string;

  const board = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@nextrole/db/migrate");
    await runMigrations();
    db = await import("@nextrole/db");
    ingest = await import("./ingest");
    alerts = await import("./alerts");
    drizzle = await import("drizzle-orm");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(
      drizzle.sql`TRUNCATE companies, jobs, users, notifications RESTART IDENTITY CASCADE`,
    );
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme", slug: "acme", ats: "greenhouse", boardToken: "acme" })
      .returning();
    companyId = company!.id;
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  it("inserts, updates and closes jobs across syncs", async () => {
    const first = await ingest.syncCompany(companyId, {
      fetch: fakeFetch({ [board]: greenhouseResponse }),
    });
    expect(first).toMatchObject({ fetched: 2, updated: 0, closed: 0 });
    expect(first.newJobIds).toHaveLength(2);

    const database = db.getDb();
    const stored = await database
      .select()
      .from(db.jobs)
      .where(drizzle.eq(db.jobs.externalId, "4012345"));
    expect(stored[0]?.descriptionHtml).not.toContain("<script");
    expect(stored[0]?.descriptionText).toContain("We build payments in Go");
    expect(stored[0]?.skills).toEqual(expect.arrayContaining(["go", "kubernetes", "postgresql"]));
    expect(stored[0]?.salaryMax).toBe(220000);

    const changed = structuredClone(greenhouseResponse);
    changed.jobs = [{ ...changed.jobs[0]!, title: "Staff Software Engineer, Payments" }];
    const second = await ingest.syncCompany(companyId, { fetch: fakeFetch({ [board]: changed }) });
    expect(second).toMatchObject({ fetched: 1, updated: 1, closed: 1, newJobIds: [] });

    const [company] = await database
      .select()
      .from(db.companies)
      .where(drizzle.eq(db.companies.id, companyId));
    expect(company).toMatchObject({ lastSyncStatus: "ok", openJobCount: 1 });

    const open = await database.select().from(db.jobs).where(drizzle.isNull(db.jobs.closedAt));
    expect(open.map((job) => job.title)).toEqual(["Staff Software Engineer, Payments"]);
  });

  it("records a failed sync on the company", async () => {
    await expect(ingest.syncCompany(companyId, { fetch: fakeFetch({}) })).rejects.toThrow();
    const [company] = await db
      .getDb()
      .select()
      .from(db.companies)
      .where(drizzle.eq(db.companies.id, companyId));
    expect(company?.lastSyncStatus).toBe("error");
    expect(company?.lastSyncError).toContain("not found");
  });

  it("alerts matching users once per job", async () => {
    const database = db.getDb();
    await database
      .insert(db.users)
      .values({ id: "user-1", name: "Asha", email: "asha@example.com" });
    await database.insert(db.profiles).values({
      userId: "user-1",
      skills: ["go", "kubernetes", "postgresql"],
      targetTitles: ["Software Engineer"],
      remotePreference: "any",
      alertMinScore: 50,
    });

    const { newJobIds } = await ingest.syncCompany(companyId, {
      fetch: fakeFetch({ [board]: greenhouseResponse }),
    });
    expect(await alerts.createJobAlerts(newJobIds)).toBe(1);
    expect(await alerts.createJobAlerts(newJobIds)).toBe(0);

    const [notification] = await database.select().from(db.notifications);
    expect(notification).toMatchObject({ userId: "user-1", type: "job_match" });
    expect(notification?.title).toContain("Senior Software Engineer, Payments");
  });
});
