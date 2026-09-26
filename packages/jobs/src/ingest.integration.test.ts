import type * as DbModule from "@gettargetrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as AlertsModule from "./alerts";
import type * as IngestModule from "./ingest";
import { ashbyResponse, fakeFetch, greenhouseResponse } from "./test-fixtures";

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
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
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

  it("stores decimal pay, such as hourly rates, as whole numbers", async () => {
    const database = db.getDb();
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme Labs", slug: "acme-labs", ats: "ashby", boardToken: "acme-labs" })
      .returning();
    const [listed] = ashbyResponse.jobs;
    const hourly = {
      jobs: [
        {
          ...listed,
          compensation: {
            summaryComponents: [
              {
                compensationType: "Salary",
                interval: "1 HOUR",
                currencyCode: "USD",
                minValue: 60.58,
                maxValue: 108.17,
              },
            ],
          },
        },
      ],
    };

    await ingest.syncCompany(company!.id, {
      fetch: fakeFetch({ "https://api.ashbyhq.com/posting-api/job-board/acme-labs": hourly }),
    });
    const [job] = await database
      .select()
      .from(db.jobs)
      .where(drizzle.eq(db.jobs.companyId, company!.id));
    expect(job).toMatchObject({
      salaryMin: 61,
      salaryMax: 108,
      salaryPeriod: "hour",
      salaryAnnualMin: 61 * 2080,
      salaryAnnualMax: 108 * 2080,
    });
  });

  it("records where a job is, how it's offered and what it says about visas", async () => {
    const database = db.getDb();
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme Labs", slug: "acme-labs", ats: "ashby", boardToken: "acme-labs" })
      .returning();
    const [listed] = ashbyResponse.jobs;
    const board = {
      jobs: [
        {
          ...listed,
          employmentType: "Contract",
          address: {
            postalAddress: {
              addressCountry: "United States",
              addressRegion: "Washington",
              addressLocality: "Seattle",
            },
          },
          descriptionHtml:
            "<p>Open to W2 or C2C.</p><p>We are unable to sponsor visas for this role.</p>",
        },
      ],
    };

    await ingest.syncCompany(company!.id, {
      fetch: fakeFetch({ "https://api.ashbyhq.com/posting-api/job-board/acme-labs": board }),
    });
    const [job] = await database
      .select()
      .from(db.jobs)
      .where(drizzle.eq(db.jobs.companyId, company!.id));
    expect(job).toMatchObject({
      countries: ["US"],
      regions: ["US-WA"],
      employmentTypes: ["contract", "w2", "c2c"],
      visaSponsorship: "no",
      citizenshipRequired: false,
    });
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

  it("picks auto-prepare candidates at or above each user's minimum match", async () => {
    const database = db.getDb();
    await database.insert(db.users).values([
      { id: "user-on", name: "Asha", email: "asha@example.com" },
      { id: "user-off", name: "Ben", email: "ben@example.com" },
      { id: "user-partial", name: "Cyd", email: "cyd@example.com" },
    ]);
    const shared = { targetTitles: ["Software Engineer"], remotePreference: "any" as const };
    await database.insert(db.profiles).values([
      {
        userId: "user-on",
        ...shared,
        skills: ["go", "kubernetes", "postgresql"],
        autoPrepareEnabled: true,
      },
      { userId: "user-off", ...shared, skills: ["go", "kubernetes", "postgresql"] },
      // One of three skills: well under the default 80% minimum.
      { userId: "user-partial", ...shared, skills: ["go"], autoPrepareEnabled: true },
    ]);

    const { newJobIds } = await ingest.syncCompany(companyId, {
      fetch: fakeFetch({ [board]: greenhouseResponse }),
    });
    const candidates = await alerts.autoPrepareCandidates(newJobIds);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.userId).toBe("user-on");
    expect(candidates[0]?.score).toBeGreaterThanOrEqual(80);
  });
});
