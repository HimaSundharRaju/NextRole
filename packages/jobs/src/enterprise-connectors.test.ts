import { describe, expect, it } from "vitest";
import { amazon, mapAmazonJob } from "./connectors/amazon";
import { eightfold } from "./connectors/eightfold";
import { oracle } from "./connectors/oracle";
import { politeFetch } from "./connectors/polite";
import { isPrivateAddress, publicOnly } from "./connectors/public-only";
import { parsePostedOn, workday } from "./connectors/workday";
import { parseLocations } from "./locations";
import {
  eightfoldDetail,
  eightfoldList,
  fakeFetch,
  oracleDetail,
  oracleList,
  pcsxDetail,
  pcsxList,
  workdayDetail,
  workdayList,
} from "./test-fixtures";

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

interface Sent {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** A fetch that answers from `respond` and records what was sent. */
function recordingFetch(respond: (request: Sent) => unknown) {
  const sent: Sent[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const request: Sent = {
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    sent.push(request);
    const answer = respond(request);
    return answer instanceof Response ? answer : json(answer);
  };
  return Object.assign(impl as typeof fetch, { sent });
}

const NVIDIA = "nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite";

describe("workday connector", () => {
  it("lists a board, then reads each new posting's details", async () => {
    const fetch = recordingFetch(({ url }) =>
      url.endsWith("/jobs") ? workdayList : workdayDetail,
    );
    const listing = await workday.listJobs(NVIDIA, { fetch });
    expect(listing.complete).toBe(true);
    expect(fetch.sent[0]).toMatchObject({
      url: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
      method: "POST",
      body: { appliedFacets: {}, limit: 20, offset: 0, searchText: "" },
    });
    const [attorney, engineer] = listing.jobs;
    expect(attorney).toMatchObject({
      externalId: "Securitized-Products-CRE-Attorney_JR-0000104532",
      location: "New York, 745 7th Avenue",
      employmentType: "Full time",
      needsHydration: true,
    });
    // "5 Locations" names none of them.
    expect(engineer?.location).toBe("");
    expect(engineer?.applyUrl).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Performance-Engineer_JR1996987",
    );

    const hydrated = await workday.hydrate!(NVIDIA, engineer!, { fetch });
    expect(fetch.sent.at(-1)?.url).toBe(
      "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Performance-Engineer_JR1996987",
    );
    expect(hydrated).toMatchObject({
      title: "Senior Systems Software Engineer - GPU Performance at Scale",
      location: "US, CA, Santa Clara / US, WA, Redmond / US, TX, Austin",
      salary: { min: 184000, max: 287500, currency: "USD", period: "year" },
      needsHydration: false,
    });
    expect(hydrated.postedAt?.toISOString()).toBe("2026-08-20T00:00:00.000Z");
    expect(hydrated.descriptionHtml).toContain("<b>CUDA</b>");
    expect(parseLocations([hydrated.location], hydrated.placeHints)).toEqual({
      countries: ["US"],
      regions: ["US-CA", "US-TX", "US-WA"],
    });
  });

  /** A board past Workday's 2,000-result cap, searchable one job family at a time. */
  function bigBoard(families: Record<string, number>, timeTypeTotal: number) {
    const total = Object.values(families).reduce((sum, count) => sum + count, 0);
    return recordingFetch(({ body }) => {
      const applied = (body?.appliedFacets ?? {}) as Record<string, string[]>;
      const family = applied.jobFamilyGroup?.[0];
      const offset = Number(body?.offset ?? 0);
      // Past the cap, Workday starts over from the first page.
      const count = family ? families[family]! : total;
      const start = offset >= 2000 ? 0 : offset;
      const size = Math.max(0, Math.min(20, Math.min(count, 2000) - start));
      return {
        total: offset === 0 ? Math.min(count, 2000) : 0,
        jobPostings: Array.from({ length: size }, (_, i) => ({
          title: `Role ${start + i}`,
          externalPath: `/job/Santa-Clara/Role_${family ?? "any"}-${start + i}`,
        })),
        facets:
          offset === 0 && !family
            ? [
                {
                  facetParameter: "jobFamilyGroup",
                  values: Object.entries(families).map(([id, n]) => ({
                    id,
                    descriptor: id,
                    count: n,
                  })),
                },
                {
                  facetParameter: "timeType",
                  values: [{ id: "full", descriptor: "Full time", count: timeTypeTotal }],
                },
                {
                  facetParameter: "locationMainGroup",
                  values: [
                    {
                      facetParameter: "locationHierarchy1",
                      values: [{ id: "us", descriptor: "United States", count: 2400 }],
                    },
                  ],
                },
              ]
            : [],
      };
    });
  }

  it("reads a board past the 2,000-result cap one job family at a time", async () => {
    const fetch = bigBoard({ engineering: 1734, sales: 328 }, 2062);
    const listing = await workday.listJobs(NVIDIA, { fetch });
    expect(listing.jobs).toHaveLength(2062);
    expect(listing.complete).toBe(true);
    expect(
      fetch.sent.filter(
        (request) =>
          request.body?.appliedFacets &&
          JSON.stringify(request.body.appliedFacets).includes("sales"),
      ),
    ).toHaveLength(Math.ceil(328 / 20));
  });

  it("calls a capped listing partial when job families miss some jobs", async () => {
    // Every job has a time type, but 100 have no job family: they can't be reached.
    const listing = await workday.listJobs(NVIDIA, {
      fetch: bigBoard({ engineering: 1734, sales: 328 }, 2162),
    });
    expect(listing.jobs).toHaveLength(2062);
    expect(listing.complete).toBe(false);
  });

  it("reads one capped search when no facet can split the board", async () => {
    // Only a tiny facet fits under the cap; searching it would find next to nothing.
    const fetch = recordingFetch(({ body }) => ({
      total: body?.offset === 0 ? 2000 : 0,
      jobPostings: Array.from({ length: 20 }, (_, i) => ({
        title: `Role ${i}`,
        externalPath: `/job/x/Role_${Number(body?.offset ?? 0) + i}`,
      })),
      facets:
        body?.offset === 0
          ? [
              {
                facetParameter: "jobFamilyGroup",
                values: [{ id: "stores", descriptor: "Stores", count: 15044 }],
              },
              { facetParameter: "distance", values: [{ id: "5", descriptor: "5 mi", count: 5 }] },
            ]
          : [],
    }));
    const listing = await workday.listJobs(NVIDIA, { fetch });
    expect(listing.jobs).toHaveLength(2000);
    expect(listing.complete).toBe(false);
    expect(
      fetch.sent.every((request) => JSON.stringify(request.body?.appliedFacets) === "{}"),
    ).toBe(true);
  });

  it("serves myworkdaysite.com boards under /recruiting", async () => {
    const fetch = recordingFetch(() => workdayList);
    const { jobs } = await workday.listJobs("wd1.myworkdaysite.com|wf|WellsFargoJobs", { fetch });
    expect(fetch.sent[0]?.url).toBe(
      "https://wd1.myworkdaysite.com/wday/cxs/wf/WellsFargoJobs/jobs",
    );
    expect(jobs[0]?.applyUrl).toMatch(
      /^https:\/\/wd1\.myworkdaysite\.com\/recruiting\/wf\/WellsFargoJobs\/job\//,
    );
  });

  it("dates listings from Workday's relative labels", () => {
    const now = new Date("2026-09-26T12:00:00Z");
    expect(parsePostedOn("Posted Today", now)).toEqual(now);
    expect(parsePostedOn("Posted Yesterday", now)?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
    expect(parsePostedOn("Posted 30+ Days Ago", now)?.toISOString()).toBe(
      "2026-08-27T12:00:00.000Z",
    );
    expect(parsePostedOn(undefined, now)).toBeNull();
  });

  it("rejects a malformed board token", async () => {
    await expect(workday.listJobs("nvidia", { fetch: fakeFetch({}) })).rejects.toThrow(
      "host|tenant|site",
    );
  });
});

describe("oracle connector", () => {
  const JPMC = "jpmc.fa.oraclecloud.com|CX_1001";

  it("lists requisitions and reads each one's description", async () => {
    const fetch = recordingFetch(({ url }) =>
      url.includes("recruitingCEJobRequisitionDetails") ? oracleDetail : oracleList,
    );
    const listing = await oracle.listJobs(JPMC, { fetch });
    expect(listing.complete).toBe(true);
    // The finder's separators reach the API unencoded.
    expect(fetch.sent[0]?.url).toContain(
      "finder=findReqs;siteNumber=CX_1001,limit=200,offset=0,sortBy=POSTING_DATES_DESC",
    );
    const [bengaluru, plano] = listing.jobs;
    expect(bengaluru).toMatchObject({
      externalId: "210743443",
      location: "Bengaluru, Karnataka, India / Mumbai, Maharashtra, India",
      department: "Software Engineering",
      applyUrl:
        "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210743443",
    });
    expect(parseLocations([bengaluru!.location], bengaluru!.placeHints).countries).toEqual(["IN"]);
    expect(plano?.workplaceType).toBe("hybrid");

    const hydrated = await oracle.hydrate!(JPMC, plano!, { fetch });
    expect(fetch.sent.at(-1)?.url).toContain("finder=ById;Id=%22210700001%22,siteNumber=CX_1001");
    expect(hydrated.descriptionHtml).toBe(
      "<p>Build trading platforms in Java and Spring.</p><ul><li>Own services on AWS</li></ul><ul><li>3+ years of Java</li></ul>",
    );
    expect(hydrated).toMatchObject({ employmentType: "Full time", needsHydration: false });
    expect(hydrated.postedAt?.toISOString()).toBe("2026-09-25T07:14:12.000Z");
  });
});

describe("eightfold connector", () => {
  it("reads sites on the older API, like Netflix's", async () => {
    const NETFLIX = "explore.jobs.netflix.net|netflix.com";
    const fetch = recordingFetch(({ url }) =>
      /\/jobs\/\d+/.test(url) ? eightfoldDetail : eightfoldList,
    );
    const listing = await eightfold.listJobs(NETFLIX, { fetch });
    expect(fetch.sent[0]?.url).toBe(
      "https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com&start=0&num=10",
    );
    expect(listing.complete).toBe(true);
    const [ai, playback] = listing.jobs;
    // The location says remote, whatever the label says.
    expect(ai).toMatchObject({ externalId: "790298014263", workplaceType: "remote" });
    expect(playback?.workplaceType).toBe("hybrid");
    expect(ai?.postedAt?.toISOString()).toBe("2024-07-23T00:00:00.000Z");

    const hydrated = await eightfold.hydrate!(NETFLIX, ai!, { fetch });
    expect(hydrated.descriptionHtml).toContain("entertain the world");
    expect(hydrated.salary).toEqual({ min: 190000, max: 920000, currency: "USD", period: "year" });
  });

  it("reads sites on the newer API, like Microsoft's", async () => {
    const MICROSOFT = "apply.careers.microsoft.com|microsoft.com|pcsx";
    const fetch = recordingFetch(({ url }) =>
      url.includes("position_details") ? pcsxDetail : pcsxList,
    );
    const listing = await eightfold.listJobs(MICROSOFT, { fetch });
    expect(fetch.sent[0]?.url).toContain("/api/pcsx/search?domain=microsoft.com&");
    const [job] = listing.jobs;
    expect(job).toMatchObject({
      externalId: "1970393556998576",
      location: "Redmond, WA, US / Mountain View, CA, US",
      workplaceType: "onsite",
      applyUrl: "https://apply.careers.microsoft.com/careers/job/1970393556998576",
    });
    expect(parseLocations([job!.location])).toEqual({
      countries: ["US"],
      regions: ["US-CA", "US-WA"],
    });

    const hydrated = await eightfold.hydrate!(MICROSOFT, job!, { fetch });
    expect(hydrated).toMatchObject({
      employmentType: "Full-Time",
      salary: { min: 139900, max: 274800, currency: "USD", period: "year" },
    });
  });
});

/** amazon.jobs in memory: jobs per country and business category, with the 10,000 cap. */
function amazonBoard(board: Record<string, Record<string, number>>) {
  const all = Object.entries(board).flatMap(([country, categories]) =>
    Object.entries(categories).flatMap(([category, count]) =>
      Array.from({ length: count }, (_, i) => ({
        country,
        category,
        id: `${country}-${category}-${i}`,
      })),
    ),
  );
  return recordingFetch(({ url }) => {
    const query = new URL(url).searchParams;
    const country = query.get("normalized_country_code[]");
    const category = query.get("business_category[]");
    const matching = all.filter(
      (job) => (!country || job.country === country) && (!category || job.category === category),
    );
    const tally = (key: "country" | "category") => {
      const counts = new Map<string, number>();
      for (const job of matching) counts.set(job[key], (counts.get(job[key]) ?? 0) + 1);
      return [...counts].map(([name, count]) => ({ [name]: count }));
    };
    const offset = Number(query.get("offset") ?? 0);
    const limit = Number(query.get("result_limit") ?? 10);
    const reachable = matching.slice(0, 10_000);
    return {
      hits: reachable.length,
      jobs: reachable.slice(offset, offset + limit).map((job) => ({
        id_icims: job.id,
        title: `Role ${job.id}`,
        description: "<p>Build things.</p>",
        country_code: job.country,
        job_path: `/en/jobs/${job.id}/role`,
      })),
      facets: {
        normalized_country_code_facet: tally("country"),
        business_category_facet: tally("category"),
      },
    };
  });
}

describe("amazon connector", () => {
  it("maps a posting with its qualifications and location", () => {
    const job = mapAmazonJob({
      id_icims: "10560963",
      title: "Data Center Technician , DCC Communities ",
      description: "Join our dynamic AWS team!",
      basic_qualifications: "- 1+ years of Linux experience<br/>- A degree in IT",
      preferred_qualifications: "- Experience with networking",
      location: "US, CA, Gilroy",
      normalized_location: "Gilroy, California, USA",
      locations: [
        '{"normalizedStateName":"California","normalizedCountryCode":"USA","city":"Gilroy","countryIso3a":"USA","countryIso2a":"US"}',
      ],
      country_code: "USA",
      posted_date: "September 25, 2026",
      job_path: "/en/jobs/10560963/data-center-technician-dcc-communities",
      job_category: "Operations, IT, & Support Engineering",
      job_schedule_type: "full-time",
    });
    expect(job).toMatchObject({
      externalId: "10560963",
      title: "Data Center Technician , DCC Communities",
      location: "Gilroy, California, USA",
      employmentType: "full-time",
      applyUrl: "https://www.amazon.jobs/en/jobs/10560963/data-center-technician-dcc-communities",
    });
    expect(job.needsHydration).toBeUndefined();
    expect(job.descriptionHtml).toContain("<h3>Basic qualifications</h3>");
    expect(job.postedAt?.getFullYear()).toBe(2026);
    expect(parseLocations([job.location], job.placeHints)).toEqual({
      countries: ["US"],
      regions: ["US-CA"],
    });
  });

  it("reads each country, and a country past the 10,000 cap one category at a time", async () => {
    const fetch = amazonBoard({ USA: { aws: 6000, retail: 4050 }, IND: { aws: 120 } });
    const listing = await amazon.listJobs("all", { fetch });
    expect(listing.jobs).toHaveLength(10_170);
    expect(listing.complete).toBe(true);
    expect(fetch.sent.some((request) => request.url.includes("business_category[]=retail"))).toBe(
      true,
    );
  });

  it("limits the board to the countries its token lists", async () => {
    const fetch = amazonBoard({ USA: { aws: 150 }, IND: { aws: 120 } });
    const listing = await amazon.listJobs("IND", { fetch });
    expect(listing.jobs).toHaveLength(120);
    expect(listing.complete).toBe(true);
  });
});

describe("politeFetch", () => {
  it("spaces requests to one host and caps how many run at once", async () => {
    let active = 0;
    let peak = 0;
    const starts: number[] = [];
    const inner = (async () => {
      starts.push(Date.now());
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active--;
      return new Response("{}");
    }) as typeof fetch;
    const polite = politeFetch(inner, { concurrency: 2, perMinute: 60_000 / 20 });
    await Promise.all(Array.from({ length: 5 }, () => polite("https://jobs.example.com/a")));
    expect(peak).toBeLessThanOrEqual(2);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(18);
    }
  });

  it("pauses a host after a 429 until its Retry-After passes", async () => {
    const starts: number[] = [];
    let calls = 0;
    const inner = (async () => {
      starts.push(Date.now());
      calls++;
      return calls === 1
        ? new Response("slow down", { status: 429, headers: { "retry-after": "0.2" } })
        : new Response("{}");
    }) as typeof fetch;
    const polite = politeFetch(inner, { concurrency: 1, perMinute: 60_000 });
    await polite("https://jobs.example.com/a");
    await polite("https://jobs.example.com/b");
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(190);
  });
});

describe("publicOnly", () => {
  const resolve = async (host: string) =>
    ({
      "jobs.example.com": ["93.184.216.34"],
      "intranet.example.com": ["10.1.2.3"],
      "mixed.example.com": ["93.184.216.35", "192.168.1.9"],
    })[host] ?? [];

  function upstream(routes: Record<string, Response | (() => Response)>) {
    const seen: Array<{ url: string; method: string }> = [];
    const impl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      seen.push({ url, method: init?.method ?? "GET" });
      const route = routes[url];
      return route instanceof Response ? route : route ? route() : new Response("{}");
    };
    return Object.assign(impl as typeof fetch, { seen });
  }

  it.each([
    ["10.0.0.5", true],
    ["172.20.1.1", true],
    ["192.168.0.10", true],
    ["127.0.0.1", true],
    ["169.254.169.254", true],
    ["100.100.1.1", true],
    ["0.0.0.0", true],
    ["::1", true],
    ["fd12:3456::1", true],
    ["fe80::1", true],
    ["::ffff:10.0.0.1", true],
    ["93.184.216.34", false],
    ["2606:4700::6810:84e5", false],
  ])("treats %s as private: %s", (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });

  it("reaches public hosts and refuses everything else", async () => {
    const fetch = publicOnly(upstream({}), resolve);
    await expect(fetch("https://jobs.example.com/api")).resolves.toBeInstanceOf(Response);
    for (const url of [
      "http://127.0.0.1:8080/admin",
      "http://[::1]/",
      "https://intranet.example.com/",
      "https://mixed.example.com/",
      "https://unknown.example.com/",
      "file:///etc/passwd",
      "https://user:secret@jobs.example.com/",
    ]) {
      await expect(fetch(url), url).rejects.toThrow();
    }
  });

  it("checks every redirect", async () => {
    const inner = upstream({
      "https://jobs.example.com/careers": new Response(null, {
        status: 302,
        headers: { location: "/careers/" },
      }),
      "https://jobs.example.com/careers/": new Response(null, {
        status: 301,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    });
    await expect(publicOnly(inner, resolve)("https://jobs.example.com/careers")).rejects.toThrow(
      "169.254.169.254 isn't a public web address",
    );
    expect(inner.seen.map((request) => request.url)).toEqual([
      "https://jobs.example.com/careers",
      "https://jobs.example.com/careers/",
    ]);
  });

  it("continues a POST answered with 303 as a GET", async () => {
    const inner = upstream({
      "https://jobs.example.com/search": new Response(null, {
        status: 303,
        headers: { location: "https://jobs.example.com/results" },
      }),
    });
    await publicOnly(inner, resolve)("https://jobs.example.com/search", {
      method: "POST",
      body: "{}",
    });
    expect(inner.seen).toEqual([
      { url: "https://jobs.example.com/search", method: "POST" },
      { url: "https://jobs.example.com/results", method: "GET" },
    ]);
  });
});
