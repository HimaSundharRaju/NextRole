import type * as DbModule from "@gettargetrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as AlertsModule from "./alerts";
import type * as GhostsModule from "./ghosts";
import type * as IngestModule from "./ingest";
import { fakeFetch, greenhouseResponse, usajobsSearch } from "./test-fixtures";
import { ensureTestDatabase, testDatabaseUrl } from "@gettargetrole/db/test-database";

const TEST_DATABASE_URL = testDatabaseUrl("jobs");
const DAY_MS = 86_400_000;

describe.skipIf(!TEST_DATABASE_URL)("ghost jobs (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let ghosts: typeof GhostsModule;
  let ingest: typeof IngestModule;
  let alerts: typeof AlertsModule;
  let companyId: string;

  const board = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    ghosts = await import("./ghosts");
    ingest = await import("./ingest");
    alerts = await import("./alerts");
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

  let externalIds = 0;
  async function addJob(values: Partial<typeof DbModule.jobs.$inferInsert> = {}) {
    const [job] = await db
      .getDb()
      .insert(db.jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `job-${++externalIds}`,
        title: "Backend Engineer",
        location: "Austin, TX",
        applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
        contentHash: "hash",
        ...values,
      })
      .returning({ id: db.jobs.id });
    return job!.id;
  }

  async function ghostOf(id: string) {
    const [job] = await db
      .getDb()
      .select({
        score: db.jobs.ghostScore,
        reasons: db.jobs.ghostReasons,
        reposts: db.jobs.repostCount,
        closedAt: db.jobs.closedAt,
      })
      .from(db.jobs)
      .where(drizzle.eq(db.jobs.id, id));
    return job!;
  }

  async function addUsers(count: number) {
    const ids = Array.from({ length: count }, (_, i) => `user-${i + 1}`);
    await db
      .getDb()
      .insert(db.users)
      .values(ids.map((id) => ({ id, name: id, email: `${id}@example.com` })));
    return ids;
  }

  it("adds points for months open, counted from the board's posting date", async () => {
    const fresh = await addJob({ postedAt: new Date(Date.now() - 10 * DAY_MS) });
    const months = await addJob({ postedAt: new Date(Date.now() - 70 * DAY_MS) });
    const seasons = await addJob({ postedAt: new Date(Date.now() - 130 * DAY_MS) });
    // No posting date: counted from when it was first seen.
    const unseen = await addJob({ firstSeenAt: new Date(Date.now() - 65 * DAY_MS) });

    expect(await ghosts.scoreGhostJobs()).toBe(3);
    expect(await ghostOf(fresh)).toMatchObject({ score: 0, reasons: [] });
    expect(await ghostOf(months)).toMatchObject({ score: 20, reasons: ["open_60d"] });
    expect(await ghostOf(seasons)).toMatchObject({ score: 35, reasons: ["open_120d"] });
    expect(await ghostOf(unseen)).toMatchObject({ score: 20, reasons: ["open_60d"] });
    // Nothing changed, so nothing is written again.
    expect(await ghosts.scoreGhostJobs()).toBe(0);
  });

  it("marks talent pools, by their title or what enrichment read", async () => {
    const pool = await addJob({ title: "Software Engineering Talent Community" });
    const general = await addJob({ title: "General Application - Engineering" });
    const flagged = await addJob({ enrichment: { evergreen: true, summary: "Always hiring." } });
    const opening = await addJob({ title: "Senior Engineer, Future Payments Platform" });
    await ghosts.scoreGhostJobs();
    for (const id of [pool, general, flagged]) {
      expect(await ghostOf(id)).toMatchObject({ score: 60, reasons: ["evergreen"] });
    }
    expect((await ghostOf(opening)).score).toBe(0);
  });

  it("counts reports from different people, up to three, and forgets withdrawn ones", async () => {
    const job = await addJob();
    const [first, second, third, fourth] = await addUsers(4);
    await ghosts.reportJob({ userId: first!, jobId: job, reason: "closed" });
    expect(await ghostOf(job)).toMatchObject({ score: 20, reasons: ["reported"] });
    // Reporting again updates the report rather than adding one.
    await ghosts.reportJob({ userId: first!, jobId: job, reason: "no_reply", note: "Silence" });
    expect((await ghostOf(job)).score).toBe(20);
    for (const userId of [second!, third!, fourth!]) {
      await ghosts.reportJob({ userId, jobId: job, reason: "not_real" });
    }
    expect((await ghostOf(job)).score).toBe(60);
    await ghosts.withdrawJobReport({ userId: first!, jobId: job });
    await ghosts.withdrawJobReport({ userId: second!, jobId: job });
    expect((await ghostOf(job)).score).toBe(40);
  });

  it("counts a role closed and posted again as a repost, but not a team hiring several", async () => {
    const database = db.getDb();
    const fingerprint = "acme|backend engineer|austin";
    const since = new Date();
    await addJob({
      fingerprint,
      repostCount: 1,
      firstSeenAt: new Date(Date.now() - 40 * DAY_MS),
      closedAt: new Date(Date.now() - 5 * DAY_MS),
    });
    const repost = await addJob({ fingerprint, firstSeenAt: since });
    await ghosts.markReposts(database, companyId, since);
    await ghosts.scoreGhostJobs();
    expect(await ghostOf(repost)).toMatchObject({ reposts: 2, score: 30, reasons: ["reposted"] });

    // A second opening of the same role while the first is open is hiring, not a repost.
    const later = new Date(since.getTime() + 1000);
    const second = await addJob({ fingerprint, firstSeenAt: later });
    await ghosts.markReposts(database, companyId, later);
    expect((await ghostOf(second)).reposts).toBe(0);

    // Postings closed more than half a year ago don't count.
    const other = "acme|data engineer|austin";
    await addJob({
      fingerprint: other,
      firstSeenAt: new Date(Date.now() - 400 * DAY_MS),
      closedAt: new Date(Date.now() - 200 * DAY_MS),
    });
    const fresh = await addJob({ fingerprint: other, firstSeenAt: later });
    await ghosts.markReposts(database, companyId, later);
    expect((await ghostOf(fresh)).reposts).toBe(0);
  });

  it("finds a repost when a sync sees a role taken down and put back up", async () => {
    await ingest.syncCompany(companyId, { fetch: fakeFetch({ [board]: greenhouseResponse }) });
    const reposted = structuredClone(greenhouseResponse);
    reposted.jobs[0] = { ...reposted.jobs[0]!, id: 5012345 };
    const { newJobIds } = await ingest.syncCompany(companyId, {
      fetch: fakeFetch({ [board]: reposted }),
    });
    expect(newJobIds).toHaveLength(1);
    expect(await ghostOf(newJobIds[0]!)).toMatchObject({
      reposts: 1,
      score: 15,
      reasons: ["reposted"],
    });
  });

  it("closes jobs whose closing date has passed, at sync and every day", async () => {
    vi.stubEnv("USAJOBS_API_KEY", "test-usajobs-key");
    vi.stubEnv("USAJOBS_EMAIL", "bot@example.com");
    const database = db.getDb();
    const [feed] = await database
      .insert(db.companies)
      .values({ name: "USAJOBS", slug: "usajobs", ats: "usajobs", boardToken: "2210" })
      .returning();
    const search = structuredClone(usajobsSearch);
    const [closing, open] = search.SearchResult.SearchResultItems;
    closing!.MatchedObjectDescriptor.ApplicationCloseDate = new Date(
      Date.now() - DAY_MS,
    ).toISOString();
    Object.assign(open!.MatchedObjectDescriptor, {
      ApplicationCloseDate: new Date(Date.now() + 10 * DAY_MS).toISOString(),
    });
    await ingest.syncCompany(feed!.id, {
      fetch: fakeFetch({ "https://data.usajobs.gov/api/search": search }),
    });
    const stored = await database
      .select({ externalId: db.jobs.externalId, closedAt: db.jobs.closedAt, id: db.jobs.id })
      .from(db.jobs)
      .orderBy(db.jobs.externalId);
    expect(stored.map((job) => job.closedAt === null)).toEqual([false, true]);

    // Listed again past its closing date, it stays closed.
    await ingest.syncCompany(feed!.id, {
      fetch: fakeFetch({ "https://data.usajobs.gov/api/search": search }),
    });
    expect((await ghostOf(stored[0]!.id)).closedAt).not.toBeNull();

    expect(await ghosts.expireJobs(database, new Date(Date.now() + 11 * DAY_MS))).toBe(1);
    expect((await ghostOf(stored[1]!.id)).closedAt).not.toBeNull();
  });

  it("sends no alerts for likely ghost jobs", async () => {
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
    const pool = structuredClone(greenhouseResponse);
    pool.jobs[0] = { ...pool.jobs[0]!, title: "Engineering Talent Pool" };
    const { newJobIds } = await ingest.syncCompany(companyId, {
      fetch: fakeFetch({ [board]: pool }),
    });
    const [job] = await database
      .select({ score: db.jobs.ghostScore })
      .from(db.jobs)
      .where(drizzle.eq(db.jobs.externalId, "4012345"));
    expect(job?.score).toBeGreaterThanOrEqual(ghosts.LIKELY_GHOST_SCORE);
    // The data analyst post has no matching skills; the talent pool is skipped.
    expect(await alerts.createJobAlerts(newJobIds)).toBe(0);
  });
});
