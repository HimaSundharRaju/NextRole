import { describe, expect, it } from "vitest";
import { ashby } from "./connectors/ashby";
import { greenhouse } from "./connectors/greenhouse";
import { BoardNotFoundError } from "./connectors/http";
import { lever } from "./connectors/lever";
import { smartrecruiters } from "./connectors/smartrecruiters";
import {
  ashbyResponse,
  fakeFetch,
  greenhouseResponse,
  leverResponse,
  smartRecruitersDetail,
  smartRecruitersList,
} from "./test-fixtures";

describe("greenhouse connector", () => {
  it("maps jobs, decodes content and reads salary", async () => {
    const fetch = fakeFetch({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs": greenhouseResponse,
    });
    const jobs = await greenhouse.listJobs("acme", { fetch });
    expect(fetch.calls[0]).toContain("content=true");
    expect(jobs).toHaveLength(2);

    const [payments, analyst] = jobs;
    expect(payments).toMatchObject({
      externalId: "4012345",
      title: "Senior Software Engineer, Payments",
      department: "Engineering",
      workplaceType: "remote",
      applyUrl: "https://job-boards.greenhouse.io/acme/jobs/4012345",
      salary: { min: 180000, max: 220000, currency: "USD", period: "year" },
    });
    expect(payments?.descriptionHtml).toContain("<strong>Go</strong>");
    expect(payments?.postedAt?.toISOString()).toBe("2026-09-18T13:00:00.000Z");
    expect(analyst?.salary).toEqual({ min: 95000, max: 120000, currency: "USD", period: "year" });
    expect(analyst?.workplaceType).toBe("unknown");
  });

  it("raises BoardNotFoundError for an unknown board", async () => {
    await expect(greenhouse.listJobs("missing", { fetch: fakeFetch({}) })).rejects.toBeInstanceOf(
      BoardNotFoundError,
    );
  });
});

describe("lever connector", () => {
  it("combines description sections and maps categories", async () => {
    const fetch = fakeFetch({ "https://api.lever.co/v0/postings/acme": leverResponse });
    const [job] = await lever.listJobs("acme", { fetch });
    expect(job).toMatchObject({
      externalId: "5f1c-lever-1",
      title: "Frontend Engineer",
      department: "Engineering · Web",
      location: "London",
      workplaceType: "hybrid",
      employmentType: "Full-time",
      applyUrl: "https://jobs.lever.co/acme/5f1c-lever-1/apply",
      salary: { min: 70000, max: 90000, currency: "GBP", period: "year" },
    });
    expect(job?.descriptionHtml).toContain("<h3>Requirements</h3><ul><li>3+ years of React</li>");
  });
});

describe("ashby connector", () => {
  it("skips unlisted jobs and reads compensation", async () => {
    const fetch = fakeFetch({
      "https://api.ashbyhq.com/posting-api/job-board/acme": ashbyResponse,
    });
    const jobs = await ashby.listJobs("acme", { fetch });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      externalId: "ashby-uuid-1",
      department: "Research · Applied ML",
      location: "Remote - US / Seattle, WA",
      workplaceType: "remote",
      employmentType: "Full-time",
      salary: { min: 200000, max: 260000, currency: "USD", period: "year" },
    });
  });
});

describe("smartrecruiters connector", () => {
  it("lists postings then hydrates details", async () => {
    const fetch = fakeFetch({
      "https://api.smartrecruiters.com/v1/companies/Acme/postings?": smartRecruitersList,
      "https://api.smartrecruiters.com/v1/companies/Acme/postings/744000012345":
        smartRecruitersDetail,
    });
    const [listed] = await smartrecruiters.listJobs("Acme", { fetch });
    expect(listed).toMatchObject({
      title: "Product Designer",
      needsHydration: true,
      descriptionHtml: "",
    });

    const hydrated = await smartrecruiters.hydrate!("Acme", listed!, { fetch });
    expect(hydrated.needsHydration).toBe(false);
    expect(hydrated.descriptionHtml).toContain("<h3>Qualifications</h3>");
    expect(hydrated.workplaceType).toBe("hybrid");
    expect(hydrated.applyUrl).toBe(smartRecruitersDetail.applyUrl);
  });
});
