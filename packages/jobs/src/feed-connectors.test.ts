import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adzuna, parseAdzunaToken } from "./connectors/adzuna";
import { usajobs } from "./connectors/usajobs";
import { parseLocations } from "./locations";
import { adzunaSearch, usajobsSearch } from "./test-fixtures";

interface Sent {
  url: URL;
  headers: Record<string, string>;
}

/** A fetch that answers from `respond` and records what was sent. */
function recordingFetch(respond: (request: Sent) => unknown) {
  const sent: Sent[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const request = {
      url: new URL(input instanceof Request ? input.url : input.toString()),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    };
    sent.push(request);
    return new Response(JSON.stringify(respond(request)), {
      headers: { "content-type": "application/json" },
    });
  };
  return Object.assign(impl as typeof fetch, { sent });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("usajobs connector", () => {
  beforeEach(() => {
    vi.stubEnv("USAJOBS_API_KEY", "test-usajobs-key");
    vi.stubEnv("USAJOBS_EMAIL", "jobs-bot@example.com");
  });

  it("maps federal posts with their agency, pay, schedule and places", async () => {
    const fetch = recordingFetch(() => usajobsSearch);
    const listing = await usajobs.listJobs("2210;1560", { fetch });
    expect(listing.complete).toBe(true);
    const [infosec, data] = listing.jobs;
    expect(infosec).toMatchObject({
      externalId: "812345600",
      title: "IT Specialist (INFOSEC)",
      employer: "Veterans Health Administration",
      department: "Department of Veterans Affairs",
      location: "Washington, District of Columbia",
      workplaceType: "hybrid",
      employmentType: "Full-time, Permanent",
      applyUrl: "https://www.usajobs.gov:443/job/812345600/apply",
      salary: { min: 117962, max: 153354, currency: "USD", period: "year" },
    });
    expect(infosec!.postedAt?.getUTCFullYear()).toBe(2026);
    // Plain text becomes escaped paragraphs under each section's heading.
    expect(infosec!.descriptionHtml).toContain(
      "<h3>Summary</h3><p>Protect the VA's networks.</p><p>Join a team of 40 engineers.</p>",
    );
    expect(infosec!.descriptionHtml).toContain("<h3>Duties</h3><p>Run vulnerability scans.</p>");
    expect(infosec!.descriptionHtml).toContain("networks &amp; systems &lt;at GS-12&gt;");
    expect(infosec!.descriptionHtml).not.toContain("<h3>Education</h3>");
    expect(parseLocations([infosec!.location], infosec!.placeHints)).toEqual({
      countries: ["US"],
      regions: ["US-DC"],
    });

    expect(data).toMatchObject({
      employer: "Census Bureau",
      location: "Denver, Colorado; Austin, Texas",
      workplaceType: "remote",
      employmentType: "Part-time, Temporary",
      salary: { min: 45.1, max: 58.63, currency: "USD", period: "hour" },
    });
    expect(parseLocations([data!.location], data!.placeHints).regions).toEqual(["US-CO", "US-TX"]);
  });

  it("sends the key and the email it was requested with, one page of 500 at a time", async () => {
    const fetch = recordingFetch(() => usajobsSearch);
    await usajobs.listJobs("2210;1560", { fetch });
    expect(fetch.sent).toHaveLength(1);
    const [request] = fetch.sent;
    expect(request!.url.origin + request!.url.pathname).toBe("https://data.usajobs.gov/api/search");
    expect(Object.fromEntries(request!.url.searchParams)).toEqual({
      JobCategoryCode: "2210;1560",
      ResultsPerPage: "500",
      Page: "1",
    });
    expect(request!.headers).toMatchObject({
      "authorization-key": "test-usajobs-key",
      "user-agent": "jobs-bot@example.com",
    });
  });

  it("reads every page of a big search, and counts one in a single request", async () => {
    const item = usajobsSearch.SearchResult.SearchResultItems[0]!;
    const page = (n: number, size: number) => ({
      SearchResult: {
        SearchResultCountAll: 1200,
        SearchResultItems: Array.from({ length: size }, (_, i) => ({
          ...item,
          MatchedObjectId: `${n}-${i}`,
        })),
      },
    });
    const fetch = recordingFetch(({ url }) => {
      const n = Number(url.searchParams.get("Page"));
      const size = Number(url.searchParams.get("ResultsPerPage"));
      return page(n, n === 3 ? 200 : size);
    });
    const listing = await usajobs.listJobs("2210", { fetch });
    expect(listing.jobs).toHaveLength(1200);
    expect(listing.complete).toBe(true);
    expect(fetch.sent.map((request) => request.url.searchParams.get("Page"))).toEqual([
      "1",
      "2",
      "3",
    ]);

    const counting = recordingFetch(() => page(1, 1));
    expect(await usajobs.countJobs!("2210", { fetch: counting })).toBe(1200);
    expect(counting.sent).toHaveLength(1);
  });

  it("says which keys are missing", async () => {
    vi.stubEnv("USAJOBS_API_KEY", "");
    await expect(usajobs.listJobs("2210", { fetch: recordingFetch(() => ({})) })).rejects.toThrow(
      "USAJOBS_API_KEY and USAJOBS_EMAIL aren't set",
    );
  });
});

describe("adzuna connector", () => {
  beforeEach(() => {
    vi.stubEnv("ADZUNA_APP_ID", "test-app-id");
    vi.stubEnv("ADZUNA_APP_KEY", "test-app-key");
  });

  it("maps jobs with their employer, and keeps only pay the ad states", async () => {
    const listing = await adzuna.listJobs("us|it-jobs|", {
      fetch: recordingFetch(() => adzunaSearch),
    });
    // Only the latest week is read, so a job missing from it isn't gone.
    expect(listing.complete).toBe(false);
    const [stated, predicted] = listing.jobs;
    expect(stated).toMatchObject({
      externalId: "4812345678",
      title: "Senior Software Engineer, Payments",
      employer: "Acme, Inc.",
      department: "IT Jobs",
      location: "San Francisco, California",
      employmentType: "permanent, full-time",
      applyUrl: "https://www.adzuna.com/land/ad/4812345678?se=abc&utm_medium=api&v=DEF",
      salary: { min: 180000, max: 220000, currency: "USD", period: "year" },
      descriptionHtml:
        "<p>Acme is hiring a Senior Software Engineer for payments. You'll build services in Go &amp; Kubernetes with &lt;5 ms latency…</p>",
    });
    expect(stated!.postedAt?.toISOString()).toBe("2026-09-25T14:03:11.000Z");
    expect(parseLocations([stated!.location], stated!.placeHints)).toEqual({
      countries: ["US"],
      regions: ["US-CA"],
    });

    // Adzuna's estimate isn't the employer's offer.
    expect(predicted).toMatchObject({
      externalId: "4812345679",
      employer: "Globex Staffing LLC",
      employmentType: "contract, full-time",
      workplaceType: "remote",
      salary: null,
    });
  });

  it("asks for the newest week of a category, and stops at a short page", async () => {
    const fetch = recordingFetch(() => adzunaSearch);
    await adzuna.listJobs("us|it-jobs|contract", { fetch });
    expect(fetch.sent).toHaveLength(1);
    const { url } = fetch.sent[0]!;
    expect(url.origin + url.pathname).toBe("https://api.adzuna.com/v1/api/jobs/us/search/1");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      app_id: "test-app-id",
      app_key: "test-app-key",
      results_per_page: "50",
      max_days_old: "7",
      sort_by: "date",
      category: "it-jobs",
      contract: "1",
    });
  });

  it("reads at most ten pages a sync", async () => {
    const [job] = adzunaSearch.results;
    const full = {
      results: Array.from({ length: 50 }, (_, i) => ({ ...job, id: String(i) })),
    };
    const fetch = recordingFetch(() => full);
    const listing = await adzuna.listJobs("gb||", { fetch });
    expect(fetch.sent).toHaveLength(10);
    expect(fetch.sent[9]!.url.pathname).toBe("/v1/api/jobs/gb/search/10");
    expect(listing.jobs[0]?.salary?.currency).toBe("GBP");
  });

  it("rejects a malformed token and says which keys are missing", async () => {
    expect(() => parseAdzunaToken("usa|it-jobs|")).toThrow("country|category|terms");
    vi.stubEnv("ADZUNA_APP_KEY", "");
    await expect(adzuna.listJobs("us||", { fetch: recordingFetch(() => ({})) })).rejects.toThrow(
      "ADZUNA_APP_ID and ADZUNA_APP_KEY aren't set",
    );
  });
});
