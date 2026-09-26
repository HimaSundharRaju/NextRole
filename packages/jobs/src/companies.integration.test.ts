import type * as DbModule from "@gettargetrole/db";
import type * as DrizzleModule from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as CompaniesModule from "./companies";
import { ashbyResponse, fakeFetch, greenhouseResponse } from "./test-fixtures";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("company discovery (Postgres integration)", () => {
  // Modules are imported after DATABASE_URL points at the test database.
  let db: typeof DbModule;
  let drizzle: typeof DrizzleModule;
  let discovery: typeof CompaniesModule;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { runMigrations } = await import("@gettargetrole/db/migrate");
    await runMigrations();
    db = await import("@gettargetrole/db");
    drizzle = await import("drizzle-orm");
    discovery = await import("./companies");
  });

  beforeEach(async () => {
    await db
      .getDb()
      .execute(drizzle.sql`TRUNCATE companies, company_requests, users RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await db?.closeDb();
  });

  const requests = () =>
    db.getDb().select().from(db.companyRequests).orderBy(db.companyRequests.createdAt);

  it("adds a board once, and keeps names unique", async () => {
    const first = await discovery.trackBoard({ name: "Acme", provider: "ashby", token: "acme" });
    expect(first.created).toBe(true);
    expect(await discovery.trackBoard({ name: "Acme", provider: "ashby", token: "acme" })).toEqual({
      id: first.id,
      created: false,
    });
    // Another board for a company of the same name gets its own slug.
    await discovery.trackBoard({ name: "Acme", provider: "lever", token: "acme-eu" });
    const slugs = (await db.getDb().select({ slug: db.companies.slug }).from(db.companies)).map(
      (row) => row.slug,
    );
    expect(slugs.sort()).toEqual(["acme", "acme-lever"]);
  });

  it("looks up requests, people's first, and records what it found", async () => {
    const database = db.getDb();
    await discovery.trackBoard({ name: "Tracked Co", provider: "ashby", token: "trackedco" });
    const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    await database.insert(db.companyRequests).values([
      { source: "yc", name: "Acme Robotics", createdAt: minutesAgo(30) },
      {
        source: "user",
        name: "",
        url: "https://jobs.ashbyhq.com/trackedco",
        createdAt: minutesAgo(20),
      },
      { source: "user", name: "Nobody Inc", createdAt: minutesAgo(10) },
    ]);
    const fetch = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acmerobotics/jobs": greenhouseResponse,
      "https://api.ashbyhq.com/posting-api/job-board/trackedco": ashbyResponse,
    });

    // One at a time: a user's request goes ahead of the older YC one.
    const first = await discovery.resolveCompanyRequests({ limit: 1, fetch });
    expect(first).toEqual({ resolved: 1, added: [] });
    expect((await requests()).map((row) => row.status)).toEqual(["pending", "tracked", "pending"]);

    const rest = await discovery.resolveCompanyRequests({ fetch });
    expect(rest.resolved).toBe(2);
    expect(rest.added).toHaveLength(1);
    const rows = await requests();
    expect(rows.map((row) => [row.status, row.note])).toEqual([
      ["added", "2 open jobs"],
      ["tracked", ""],
      ["not_found", "No job board we can read was found."],
    ]);
    const [company] = await database
      .select()
      .from(db.companies)
      .where(drizzle.eq(db.companies.id, rest.added[0]!));
    expect(company).toMatchObject({
      name: "Acme Robotics",
      ats: "greenhouse",
      boardToken: "acmerobotics",
    });
    expect(rows[0]?.companyId).toBe(company!.id);
  });

  it("skips a request another run is looking up, until its claim lapses", async () => {
    const database = db.getDb();
    await database.insert(db.companyRequests).values({
      source: "user",
      name: "Acme Robotics",
      createdAt: new Date(Date.now() - 3600_000),
    });
    // Claimed five minutes ago by a run that is still going.
    await database.execute(
      drizzle.sql`update company_requests set claimed_at = now() - interval '5 minutes'`,
    );
    const fetch = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acmerobotics/jobs": greenhouseResponse,
    });
    expect(await discovery.resolveCompanyRequests({ fetch })).toEqual({ resolved: 0, added: [] });
    await database.execute(
      drizzle.sql`update company_requests set claimed_at = now() - interval '11 minutes'`,
    );
    expect((await discovery.resolveCompanyRequests({ fetch })).resolved).toBe(1);
  });

  it("queues hiring YC companies that aren't tracked or queued yet", async () => {
    const database = db.getDb();
    await discovery.trackBoard({ name: "Airbnb", provider: "greenhouse", token: "airbnb" });
    await database.insert(db.companyRequests).values({ source: "yc", name: "Already Queued" });
    const fetch = fakeFetch({
      [discovery.YC_HIRING_URL]: [
        { name: "Airbnb", website: "https://airbnb.com", isHiring: true },
        { name: "Already Queued", website: "https://queued.example", isHiring: true },
        { name: "Fresh Startup", website: "https://fresh.example", isHiring: true },
        { name: "Fresh Startup", website: "https://fresh.example", isHiring: true },
        { name: "Gone Co", website: "https://gone.example", isHiring: true, status: "Inactive" },
        { name: "No Website", website: "", isHiring: true },
      ],
    });
    expect(await discovery.importYcCompanies({ fetch })).toBe(2);
    const queued = (await requests())
      .filter((row) => row.status === "pending")
      .map((row) => [row.name, row.url]);
    expect(queued).toEqual([
      ["Already Queued", ""],
      ["Fresh Startup", "https://fresh.example"],
      ["No Website", ""],
    ]);
  });
});
