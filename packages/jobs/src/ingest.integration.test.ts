import type * as DbModule from "@gettargetrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as AlertsModule from "./alerts";
import type * as IngestModule from "./ingest";
import {
  adzunaSearch,
  ashbyResponse,
  bullhornContract,
  bullhornDirectHire,
  fakeFetch,
  greenhouseResponse,
  smartRecruitersDetail,
  smartRecruitersList,
  workdayDetail,
  workdayList,
} from "./test-fixtures";
import { ensureTestDatabase, testDatabaseUrl } from "@gettargetrole/db/test-database";

const TEST_DATABASE_URL = testDatabaseUrl("jobs");

describe.skipIf(!TEST_DATABASE_URL)("job ingestion (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let ingest: typeof IngestModule;
  let alerts: typeof AlertsModule;
  let drizzle: typeof DrizzleModule;
  let companyId: string;

  const board = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
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

  afterEach(() => {
    vi.unstubAllEnvs();
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

  async function companyRow(id = companyId) {
    const [row] = await db
      .getDb()
      .select()
      .from(db.companies)
      .where(drizzle.eq(db.companies.id, id));
    return row!;
  }

  function greenhouseBoard(count: number) {
    const [template] = greenhouseResponse.jobs;
    return {
      jobs: Array.from({ length: count }, (_, i) => ({
        ...template!,
        id: 5000 + i,
        title: `Engineer ${i}`,
        absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${5000 + i}`,
      })),
    };
  }

  it("keeps what only a posting's details say when the listing shows it again", async () => {
    const database = db.getDb();
    const [company] = await database
      .insert(db.companies)
      .values({
        name: "NVIDIA",
        slug: "nvidia",
        ats: "workday",
        boardToken: "nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite",
      })
      .returning();
    const site = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite";
    const routes = {
      [`${site}/jobs`]: workdayList,
      [`${site}/job/US-CA-Santa-Clara`]: workdayDetail,
      [`${site}/job/New-York`]: {
        jobPostingInfo: {
          ...workdayDetail.jobPostingInfo,
          title: "Securitized Products CRE Attorney",
          location: "New York, 745 7th Avenue",
          additionalLocations: [],
        },
      },
    };
    const first = await ingest.syncCompany(company!.id, { fetch: fakeFetch(routes) });
    expect(first.newJobIds).toHaveLength(2);

    const second = await ingest.syncCompany(company!.id, { fetch: fakeFetch(routes) });
    expect(second).toMatchObject({ fetched: 2, newJobIds: [], closed: 0, closedMissing: true });
    const [engineer] = await database
      .select()
      .from(db.jobs)
      .where(drizzle.eq(db.jobs.externalId, "Senior-Performance-Engineer_JR1996987"));
    // The listing says "5 Locations"; the stored locations from the details stay.
    expect(engineer).toMatchObject({
      location: "US, CA, Santa Clara / US, WA, Redmond / US, TX, Austin",
      regions: ["US-CA", "US-TX", "US-WA"],
      closedAt: null,
    });
    expect(engineer?.descriptionText).toContain("CUDA");
  });

  it("closes nothing when the board could list only part of its jobs", async () => {
    const database = db.getDb();
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme SR", slug: "acme-sr", ats: "smartrecruiters", boardToken: "Acme" })
      .returning();
    const list = "https://api.smartrecruiters.com/v1/companies/Acme/postings?";
    const detail = "https://api.smartrecruiters.com/v1/companies/Acme/postings/744000012345";
    await ingest.syncCompany(company!.id, {
      fetch: fakeFetch({ [list]: smartRecruitersList, [detail]: smartRecruitersDetail }),
    });
    // The board says it has one posting but lists none of them.
    const partial = { ...smartRecruitersList, totalFound: 1, content: [] };
    const result = await ingest.syncCompany(company!.id, { fetch: fakeFetch({ [list]: partial }) });
    expect(result).toMatchObject({ closed: 0, closedMissing: false });
    const open = () =>
      database
        .select()
        .from(db.jobs)
        .where(
          drizzle.and(drizzle.eq(db.jobs.companyId, company!.id), drizzle.isNull(db.jobs.closedAt)),
        );
    expect(await open()).toHaveLength(1);
    expect((await companyRow(company!.id)).openJobCount).toBe(1);

    // Unseen for over two weeks, though, it's taken as gone.
    await database
      .update(db.jobs)
      .set({ lastSeenAt: new Date(Date.now() - 15 * 86_400_000) })
      .where(drizzle.eq(db.jobs.companyId, company!.id));
    const later = await ingest.syncCompany(company!.id, { fetch: fakeFetch({ [list]: partial }) });
    expect(later).toMatchObject({ closed: 1, closedMissing: false });
    expect(await open()).toHaveLength(0);
  });

  it("flags a board that suddenly lists far fewer jobs, until the drop lasts", async () => {
    await ingest.syncCompany(companyId, { fetch: fakeFetch({ [board]: greenhouseBoard(25) }) });
    const shrunk = fakeFetch({ [board]: greenhouseBoard(2) });

    for (let attempt = 1; attempt <= 2; attempt++) {
      const result = await ingest.syncCompany(companyId, { fetch: shrunk });
      expect(result).toMatchObject({ closed: 0, closedMissing: false });
      expect(await companyRow()).toMatchObject({
        lastSyncStatus: "error",
        lastSyncError: "Listed 2 jobs, down from 25; none were closed",
        openJobCount: 25,
        syncFailures: attempt,
      });
    }
    // The third sync in a row with the same drop accepts it.
    const accepted = await ingest.syncCompany(companyId, { fetch: shrunk });
    expect(accepted).toMatchObject({ closed: 23, closedMissing: true });
    expect(await companyRow()).toMatchObject({
      lastSyncStatus: "ok",
      openJobCount: 2,
      syncFailures: 0,
    });
  });

  it("syncs big boards less often and backs off from failing ones", async () => {
    const database = db.getDb();
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    await database.update(db.companies).set({ lastSyncedAt: minutesAgo(15) });
    const rows = await database
      .insert(db.companies)
      .values([
        // Workday boards sync every 3 hours.
        {
          name: "W1",
          slug: "w1",
          ats: "workday",
          boardToken: "a|b|c",
          lastSyncedAt: minutesAgo(60),
        },
        {
          name: "W2",
          slug: "w2",
          ats: "workday",
          boardToken: "d|e|f",
          lastSyncedAt: minutesAgo(200),
        },
        // Two failures in a row: 10 minutes × 4.
        {
          name: "Failing",
          slug: "failing",
          ats: "lever",
          boardToken: "failing",
          lastSyncedAt: minutesAgo(15),
          syncFailures: 2,
        },
        {
          name: "Eager",
          slug: "eager",
          ats: "lever",
          boardToken: "eager",
          lastSyncedAt: minutesAgo(6),
          syncIntervalMinutes: 5,
        },
        { name: "Paused", slug: "paused", ats: "lever", boardToken: "paused", active: false },
      ])
      .returning({ id: db.companies.id, slug: db.companies.slug });
    const due = new Set(await ingest.companiesDueForSync(10 * 60_000));
    const bySlug = Object.fromEntries(rows.map((row) => [row.slug, due.has(row.id)]));
    expect(bySlug).toEqual({ w1: false, w2: true, failing: false, eager: true, paused: false });
    expect(due.has(companyId)).toBe(true);
  });

  it("deletes long-closed jobs unless an application points to them", async () => {
    const database = db.getDb();
    await ingest.syncCompany(companyId, { fetch: fakeFetch({ [board]: greenhouseBoard(3) }) });
    const [kept, old, recent] = await database
      .select({ id: db.jobs.id })
      .from(db.jobs)
      .orderBy(db.jobs.externalId);
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
    await database
      .update(db.jobs)
      .set({ closedAt: daysAgo(90) })
      .where(drizzle.inArray(db.jobs.id, [kept!.id, old!.id]));
    await database
      .update(db.jobs)
      .set({ closedAt: daysAgo(10) })
      .where(drizzle.eq(db.jobs.id, recent!.id));
    await database
      .insert(db.users)
      .values({ id: "user-a", name: "Asha", email: "asha@example.com" });
    await database.insert(db.applications).values({
      userId: "user-a",
      jobId: kept!.id,
      companyName: "Acme",
      jobTitle: "Engineer 0",
      jobUrl: "https://job-boards.greenhouse.io/acme/jobs/5000",
    });

    expect(await ingest.pruneClosedJobs()).toBe(1);
    const left = (await database.select({ id: db.jobs.id }).from(db.jobs)).map((row) => row.id);
    expect(left.sort()).toEqual([kept!.id, recent!.id].sort());
  });

  it("keeps what enrichment filled in until the post changes", async () => {
    const database = db.getDb();
    await ingest.syncCompany(companyId, { fetch: fakeFetch({ [board]: greenhouseResponse }) });
    const [stored] = await database
      .select()
      .from(db.jobs)
      .where(drizzle.eq(db.jobs.externalId, "4012346"));
    expect(stored).toMatchObject({ employmentTypes: ["full_time"], visaSponsorship: "unknown" });
    // What an enrichment batch would have written for this exact content.
    await database
      .update(db.jobs)
      .set({
        employmentTypes: ["contract", "w2"],
        visaSponsorship: "no",
        workplaceType: "hybrid",
        enrichedHash: stored!.contentHash,
      })
      .where(drizzle.eq(db.jobs.id, stored!.id));

    await ingest.syncCompany(companyId, { fetch: fakeFetch({ [board]: greenhouseResponse }) });
    const [kept] = await database.select().from(db.jobs).where(drizzle.eq(db.jobs.id, stored!.id));
    expect(kept).toMatchObject({
      employmentTypes: ["contract", "w2"],
      visaSponsorship: "no",
      workplaceType: "hybrid",
    });

    // A changed post goes back to what the parsers read, until it's enriched again.
    const changed = structuredClone(greenhouseResponse);
    changed.jobs[1]!.title = "Senior Data Analyst";
    await ingest.syncCompany(companyId, { fetch: fakeFetch({ [board]: changed }) });
    const [reset] = await database.select().from(db.jobs).where(drizzle.eq(db.jobs.id, stored!.id));
    expect(reset).toMatchObject({
      employmentTypes: ["full_time"],
      visaSponsorship: "unknown",
      workplaceType: "unknown",
    });
    expect(reset!.enrichedHash).not.toBe(reset!.contentHash);
  });

  it("stores the years and sponsorship a staffing board states", async () => {
    const database = db.getDb();
    const [company] = await database
      .insert(db.companies)
      .values({ name: "CEI", slug: "cei", ats: "bullhorn", boardToken: "30|3vcpe1|cei.ai/jobs" })
      .returning();
    const feed = "https://public-rest30.bullhornstaffing.com/rest-services/3vcpe1/search/JobOrder";
    // Only the board says this role can sponsor.
    const direct = {
      ...bullhornDirectHire,
      publicDescription: "<p>Senior, customer-focused role.</p>",
    };
    const sync = (data: unknown[]) =>
      ingest.syncCompany(company!.id, {
        fetch: fakeFetch({ [feed]: { total: data.length, data } }),
      });
    await sync([bullhornContract, direct]);
    const byId = async () =>
      Object.fromEntries(
        (
          await database.select().from(db.jobs).where(drizzle.eq(db.jobs.companyId, company!.id))
        ).map((job) => [job.externalId, job]),
      );
    let stored = await byId();
    expect(stored["32799"]).toMatchObject({
      yearsMin: 3,
      employmentTypes: ["contract", "w2"],
      salaryMin: 63,
      salaryPeriod: "hour",
    });
    expect(stored["54384"]).toMatchObject({ yearsMin: null, visaSponsorship: "yes" });

    // Years enrichment read for the post with none survive an unchanged resync...
    await database
      .update(db.jobs)
      .set({ yearsMin: 6 })
      .where(drizzle.eq(db.jobs.externalId, "54384"));
    await sync([bullhornContract, direct]);
    stored = await byId();
    expect(stored["54384"]?.yearsMin).toBe(6);
    // ...but not a change to the post; the board's own figure always stands.
    await sync([bullhornContract, { ...direct, title: "Solutions Manager" }]);
    stored = await byId();
    expect(stored["54384"]?.yearsMin).toBeNull();
    expect(stored["32799"]?.yearsMin).toBe(3);
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
    expect(company?.syncFailures).toBe(1);
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
      { id: "user-on", name: "Asha", email: "asha@example.com", plan: "pro" },
      { id: "user-off", name: "Ben", email: "ben@example.com", plan: "pro" },
      { id: "user-partial", name: "Cyd", email: "cyd@example.com", plan: "pro" },
      // Auto-prepare switched on, but the Plus plan doesn't include it.
      { id: "user-plus", name: "Dev", email: "dev@example.com", plan: "plus" },
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
      {
        userId: "user-plus",
        ...shared,
        skills: ["go", "kubernetes", "postgresql"],
        autoPrepareEnabled: true,
      },
    ]);

    const { newJobIds } = await ingest.syncCompany(companyId, {
      fetch: fakeFetch({ [board]: greenhouseResponse }),
    });
    const candidates = await alerts.autoPrepareCandidates(newJobIds);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.userId).toBe("user-on");
    expect(candidates[0]?.score).toBeGreaterThanOrEqual(80);
  });

  it("fingerprints jobs stored before fingerprints existed", async () => {
    const database = db.getDb();
    await database.insert(db.jobs).values({
      companyId,
      source: "greenhouse",
      externalId: "legacy-1",
      title: "Platform Engineer",
      location: "Austin, TX",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/legacy-1",
      contentHash: "legacy",
    });
    await ingest.syncCompany(companyId, { fetch: fakeFetch({ [board]: greenhouseResponse }) });
    const rows = await database
      .select({ externalId: db.jobs.externalId, fingerprint: db.jobs.fingerprint })
      .from(db.jobs)
      .orderBy(db.jobs.externalId);
    expect(rows).toEqual([
      {
        externalId: "4012345",
        fingerprint: "acme|senior software engineer payments|san francisco",
      },
      { externalId: "4012346", fingerprint: "acme|data analyst|new york" },
      { externalId: "legacy-1", fingerprint: "acme|platform engineer|austin" },
    ]);
  });

  describe("feeds", () => {
    const adzunaApi = "https://api.adzuna.com/v1/api/jobs/us/search/";
    const addFeed = async (name: string, boardToken: string) => {
      const [feed] = await db
        .getDb()
        .insert(db.companies)
        .values({ name, slug: db.slugify(name), ats: "adzuna", boardToken })
        .returning();
      return feed!.id;
    };
    const stored = async () => {
      const rows = await db
        .getDb()
        .select({
          id: db.jobs.id,
          companyId: db.jobs.companyId,
          externalId: db.jobs.externalId,
          employerName: db.jobs.employerName,
          duplicateOf: db.jobs.duplicateOf,
        })
        .from(db.jobs);
      return (company: string, externalId: string) =>
        rows.find((row) => row.companyId === company && row.externalId === externalId)!;
    };

    beforeEach(() => {
      vi.stubEnv("ADZUNA_APP_ID", "test-app-id");
      vi.stubEnv("ADZUNA_APP_KEY", "test-app-key");
    });

    it("shows the employer's own listing instead of feeds' copies, until it closes", async () => {
      const feed = await addFeed("Adzuna (US IT jobs)", "us|it-jobs|");
      const contracts = await addFeed("Adzuna (US IT contracts)", "us|it-jobs|contract");
      const fromAdzuna = { fetch: fakeFetch({ [adzunaApi]: adzunaSearch }) };

      // The feed is read before the employer's board, and another feed after: either order pairs them.
      await ingest.syncCompany(feed, fromAdzuna);
      await ingest.syncCompany(companyId, { fetch: fakeFetch({ [board]: greenhouseResponse }) });
      await ingest.syncCompany(contracts, fromAdzuna);

      let job = await stored();
      const listing = job(companyId, "4012345");
      expect(listing).toMatchObject({ employerName: null, duplicateOf: null });
      expect(job(feed, "4812345678")).toMatchObject({
        employerName: "Acme, Inc.",
        duplicateOf: listing.id,
      });
      expect(job(contracts, "4812345678").duplicateOf).toBe(listing.id);
      // Two feeds carrying one ad show it once: the copy seen first.
      expect(job(feed, "4812345679").duplicateOf).toBeNull();
      expect(job(contracts, "4812345679").duplicateOf).toBe(job(feed, "4812345679").id);

      // A third feed carrying both ads has nothing new to show, so it sends no alerts.
      const database = db.getDb();
      await database
        .insert(db.users)
        .values({ id: "user-1", name: "Asha", email: "asha@example.com" });
      await database.insert(db.profiles).values({
        userId: "user-1",
        skills: ["go", "kubernetes", "postgresql"],
        targetTitles: ["Software Engineer"],
        remotePreference: "any",
        alertMinScore: 1,
      });
      const third = await ingest.syncCompany(await addFeed("Adzuna (US)", "us||"), fromAdzuna);
      expect(third.newJobIds).toHaveLength(2);
      expect(await alerts.createJobAlerts(third.newJobIds)).toBe(0);
      expect(await alerts.createJobAlerts([listing.id])).toBe(1);

      // The employer's listing closes: its copies stand on their own again, the first one shown.
      await ingest.syncCompany(companyId, {
        fetch: fakeFetch({ [board]: { jobs: [greenhouseResponse.jobs[1]] } }),
      });
      job = await stored();
      expect(job(feed, "4812345678").duplicateOf).toBeNull();
      expect(job(contracts, "4812345678").duplicateOf).toBe(job(feed, "4812345678").id);
    });

    it("keeps snippet-only feeds out of auto-prepare", async () => {
      const database = db.getDb();
      await database
        .insert(db.users)
        .values({ id: "user-on", name: "Asha", email: "asha@example.com", plan: "pro" });
      await database.insert(db.profiles).values({
        userId: "user-on",
        targetTitles: ["Software Engineer"],
        remotePreference: "any",
        skills: ["go", "kubernetes"],
        autoPrepareEnabled: true,
        autoPrepareMinScore: 1,
      });
      const { newJobIds } = await ingest.syncCompany(
        await addFeed("Adzuna (US IT jobs)", "us|it-jobs|"),
        {
          fetch: fakeFetch({ [adzunaApi]: adzunaSearch }),
        },
      );
      expect(newJobIds).toHaveLength(2);
      expect(await alerts.autoPrepareCandidates(newJobIds)).toEqual([]);
    });
  });
});
