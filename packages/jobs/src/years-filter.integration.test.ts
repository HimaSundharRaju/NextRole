import type * as DbModule from "@gettargetrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as SeniorityModule from "./seniority";
import { TITLE_LEVELS } from "./test-fixtures";
import type * as YearsFilterModule from "./years-filter";
import { ensureTestDatabase, testDatabaseUrl } from "@gettargetrole/db/test-database";

const TEST_DATABASE_URL = testDatabaseUrl("jobs");

interface Spec {
  title: string;
  yearsMin?: number;
  seniority?: (typeof DbModule.SENIORITY_LEVELS)[number];
}

describe.skipIf(!TEST_DATABASE_URL)("years filter (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let seniority: typeof SeniorityModule;
  let yearsFilter: typeof YearsFilterModule;
  let companyId: string;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    seniority = await import("./seniority");
    yearsFilter = await import("./years-filter");
  });

  beforeEach(async () => {
    const database = db.getDb();
    await database.execute(drizzle.sql`TRUNCATE companies, jobs RESTART IDENTITY CASCADE`);
    const [company] = await database
      .insert(db.companies)
      .values({ name: "Acme", slug: "acme", ats: "greenhouse", boardToken: "acme" })
      .returning();
    companyId = company!.id;
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  let externalIds = 0;
  async function addJob(spec: Spec) {
    const [job] = await db
      .getDb()
      .insert(db.jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `job-${++externalIds}`,
        title: spec.title,
        location: "Austin, TX",
        applyUrl: "https://job-boards.greenhouse.io/acme/jobs/1",
        contentHash: "hash",
        yearsMin: spec.yearsMin ?? null,
        seniority: spec.seniority ?? null,
      })
      .returning({ id: db.jobs.id });
    return job!.id;
  }

  async function keptTitles(maxYears: number) {
    const rows = await db
      .getDb()
      .select({ title: db.jobs.title })
      .from(db.jobs)
      .where(yearsFilter.withinMaxYears(maxYears));
    return rows.map((row) => row.title).sort();
  }

  it("drops senior-sounding jobs that state no years, and keeps the rest", async () => {
    await addJob({ title: "Data Engineer" });
    await addJob({ title: "Software Engineer II, Big Data" });
    await addJob({ title: "Senior Software Engineer, Data Engineering" });
    await addJob({ title: "Staff Software Engineer, Data Warehouse" });
    await addJob({ title: "Principal Engineer, Big Data Platform" });
    await addJob({ title: "Staff Software Engineer", yearsMin: 3 }); // the post's own figure wins
    await addJob({ title: "Data Engineer", yearsMin: 9 });

    expect(await keptTitles(2)).toEqual(["Data Engineer", "Software Engineer II, Big Data"]);
    expect(await keptTitles(5)).toEqual([
      "Data Engineer",
      "Senior Software Engineer, Data Engineering",
      "Software Engineer II, Big Data",
      "Staff Software Engineer",
    ]);
    expect(await keptTitles(8)).toEqual([
      "Data Engineer",
      "Senior Software Engineer, Data Engineering",
      "Software Engineer II, Big Data",
      "Staff Software Engineer",
      "Staff Software Engineer, Data Warehouse",
    ]);
  });

  it("reads every title the way the TypeScript does", async () => {
    const specs: Spec[] = [
      ...TITLE_LEVELS.map(([title]) => ({ title })),
      { title: "Staff Software Engineer, Data Warehouse", yearsMin: 3 },
      { title: "Data Engineer", yearsMin: 9 },
      { title: "Senior Data Engineer", seniority: "mid" },
      { title: "Data Engineer", seniority: "principal" },
    ];
    const byId = new Map<string, Spec>();
    for (const spec of specs) byId.set(await addJob(spec), spec);

    for (const maxYears of [2, 5, 8]) {
      const kept = await db
        .getDb()
        .select({ id: db.jobs.id })
        .from(db.jobs)
        .where(yearsFilter.withinMaxYears(maxYears));
      const keptIds = new Set(kept.map((row) => row.id));
      const disagreements = [...byId]
        .filter(([id, spec]) => keptIds.has(id) !== seniority.withinYears(spec, maxYears))
        .map(([, spec]) => `${spec.title} (up to ${maxYears} years)`);
      expect(disagreements).toEqual([]);
    }
  });
});
