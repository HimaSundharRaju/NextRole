import { describe, expect, it } from "vitest";
import {
  detectBoard,
  discoverBoard,
  findBoardLinks,
  findCareersLinks,
  robotsAllows,
  slugCandidates,
} from "./discovery";
import { ashbyResponse, eightfoldList, greenhouseResponse, pcsxList } from "./test-fixtures";

describe("detectBoard", () => {
  it.each([
    ["https://boards.greenhouse.io/stripe", "greenhouse", "stripe"],
    ["https://job-boards.greenhouse.io/anthropic/jobs/4012345", "greenhouse", "anthropic"],
    [
      "https://boards.greenhouse.io/embed/job_board?for=figma&b=https://figma.com",
      "greenhouse",
      "figma",
    ],
    ["https://boards-api.greenhouse.io/v1/boards/discord/jobs", "greenhouse", "discord"],
    ["https://jobs.lever.co/palantir/5f1c-lever-1/apply", "lever", "palantir"],
    ["https://jobs.ashbyhq.com/openai", "ashby", "openai"],
    ["https://api.ashbyhq.com/posting-api/job-board/ramp", "ashby", "ramp"],
    ["https://jobs.smartrecruiters.com/Visa/744000012345", "smartrecruiters", "Visa"],
    [
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Engineer_JR1",
      "workday",
      "nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite",
    ],
    [
      "https://barclays.wd3.myworkdayjobs.com/External_Career_Site_Barclays",
      "workday",
      "barclays.wd3.myworkdayjobs.com|barclays|External_Career_Site_Barclays",
    ],
    [
      "https://ghr.wd1.myworkdayjobs.com/wday/cxs/ghr/Lateral-US/jobs",
      "workday",
      "ghr.wd1.myworkdayjobs.com|ghr|Lateral-US",
    ],
    [
      "https://wd1.myworkdaysite.com/en-US/recruiting/wf/WellsFargoJobs",
      "workday",
      "wd1.myworkdaysite.com|wf|WellsFargoJobs",
    ],
    [
      "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs",
      "oracle",
      "jpmc.fa.oraclecloud.com|CX_1001",
    ],
    [
      "https://explore.jobs.netflix.net/careers?domain=netflix.com",
      "eightfold",
      "explore.jobs.netflix.net|netflix.com",
    ],
    ["https://www.amazon.jobs/en/jobs/10560963/role", "amazon", "all"],
  ])("reads %s", (url, provider, token) => {
    expect(detectBoard(url)).toEqual({ provider, token });
  });

  it.each([
    "https://stripe.com/jobs",
    "https://boards.greenhouse.io/",
    "https://nvidia.wd5.myworkdayjobs.com/",
    "ftp://jobs.lever.co/acme",
    "not a url",
  ])("finds no board in %s", (url) => {
    expect(detectBoard(url)).toBeNull();
  });
});

describe("page scanning", () => {
  const page = `
    <html><head><script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script></head>
    <body>
      <a href="/about">About</a>
      <a href="https://jobs.lever.co/acme-eu">European roles</a>
      <a href="https://jobs.lever.co/acme-eu">European roles again</a>
      <script>window.jobs = "https://acme.wd1.myworkdayjobs.com/External";</script>
    </body></html>`;

  it("finds the boards a careers page links to or embeds", () => {
    expect(findBoardLinks(page, "https://acme.com/careers")).toEqual([
      { provider: "greenhouse", token: "acme" },
      { provider: "lever", token: "acme-eu" },
      { provider: "workday", token: "acme.wd1.myworkdayjobs.com|acme|External" },
    ]);
  });

  it("finds a website's careers links", () => {
    const home = `<nav><a href="/pricing">Pricing</a><a href="/company/careers#open">We're hiring</a>
      <a href="https://jobs.example.org"><span>Join us</span></a><a href="mailto:jobs@acme.com">Email</a></nav>`;
    expect(findCareersLinks(home, "https://acme.com")).toEqual([
      "https://acme.com/company/careers",
      "https://jobs.example.org/",
    ]);
  });
});

describe("robotsAllows", () => {
  const robots = `
    User-agent: GoogleBot
    Disallow: /

    User-agent: *
    Disallow: /private
    Allow: /private/careers
    Disallow: /*.pdf$
  `;

  it("applies the longest matching rule for every crawler", () => {
    expect(robotsAllows(robots, "/careers")).toBe(true);
    expect(robotsAllows(robots, "/private/team")).toBe(false);
    expect(robotsAllows(robots, "/private/careers/jobs")).toBe(true);
    expect(robotsAllows(robots, "/files/handbook.pdf")).toBe(false);
    expect(robotsAllows("", "/anything")).toBe(true);
  });

  it("follows rules written for this crawler over the general ones", () => {
    const specific = "User-agent: GetTargetRoleBot\nDisallow: /careers\n\nUser-agent: *\nAllow: /";
    expect(robotsAllows(specific, "/careers")).toBe(false);
  });
});

describe("slugCandidates", () => {
  it("tries the name run together, hyphenated, and the site's name", () => {
    expect(slugCandidates("Scale AI, Inc.", "https://www.scale.com")).toEqual([
      "scaleai",
      "scale-ai",
      "scale",
    ]);
    expect(slugCandidates("Procter & Gamble")).toEqual(["procterandgamble", "procter-and-gamble"]);
    expect(slugCandidates("Crème Brûlée Labs", "https://careers.cbl.io")).toEqual([
      "cremebruleelabs",
      "creme-brulee-labs",
    ]);
  });
});

/** Serves JSON or HTML by URL prefix; everything else is a 404. */
function site(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push(url);
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => url.startsWith(prefix));
    const body = key === undefined ? undefined : routes[key];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (body instanceof Response) return body;
    return typeof body === "string"
      ? new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } })
      : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  return Object.assign(impl as typeof fetch, { calls });
}

describe("discoverBoard", () => {
  it("checks a link that is a board", async () => {
    const fetch = site({ "https://api.ashbyhq.com/posting-api/job-board/acme": ashbyResponse });
    const found = await discoverBoard(
      { name: "", url: "https://jobs.ashbyhq.com/acme" },
      { fetch },
    );
    expect(found).toEqual({ provider: "ashby", token: "acme", openJobs: 1, suggestedName: "Acme" });
  });

  it("follows a website to its careers page and the board it embeds", async () => {
    const fetch = site({
      "https://one.example/robots.txt": "User-agent: *\nDisallow: /admin",
      "https://one.example/careers": `<script src="https://boards.greenhouse.io/embed/job_board/js?for=oneco"></script>`,
      "https://one.example/": `<a href="/careers">Careers</a>`,
      "https://boards-api.greenhouse.io/v1/boards/oneco/jobs": greenhouseResponse,
    });
    const found = await discoverBoard({ name: "One Co", url: "https://one.example/" }, { fetch });
    expect(found).toMatchObject({
      provider: "greenhouse",
      token: "oneco",
      openJobs: 2,
      suggestedName: "One Co",
    });
  });

  it("doesn't read pages robots.txt closes to crawlers", async () => {
    const fetch = site({
      "https://two.example/robots.txt": "User-agent: *\nDisallow: /",
      "https://two.example/careers": `<a href="https://jobs.lever.co/twoco">Jobs</a>`,
    });
    expect(
      await discoverBoard({ name: "", url: "https://two.example/careers" }, { fetch }),
    ).toBeNull();
    expect(fetch.calls).not.toContain("https://two.example/careers");
  });

  it("guesses board names, keeping only boards with open jobs", async () => {
    const fetch = site({
      "https://api.ashbyhq.com/posting-api/job-board/acmerobotics": { jobs: [] },
      "https://boards-api.greenhouse.io/v1/boards/acmerobotics/jobs": greenhouseResponse,
    });
    const found = await discoverBoard({ name: "Acme Robotics", url: "" }, { fetch });
    expect(found).toMatchObject({ provider: "greenhouse", token: "acmerobotics", openJobs: 2 });
  });

  it("finds an Eightfold site on whichever API it opens", async () => {
    const fetch = site({
      "https://careers.bigco.example/robots.txt": "",
      "https://careers.bigco.example/careers": `<link href="https://static.vscdn.net/fonts/css/eightfold-font-base.css">`,
      "https://careers.bigco.example/api/apply/v2/jobs": new Response("{}", { status: 403 }),
      "https://careers.bigco.example/api/pcsx/search?domain=bigco.example": pcsxList,
    });
    const found = await discoverBoard(
      { name: "BigCo", url: "https://careers.bigco.example/careers" },
      { fetch },
    );
    expect(found).toMatchObject({
      provider: "eightfold",
      token: "careers.bigco.example|bigco.example|pcsx",
      openJobs: 1,
    });
  });

  it("tries both Eightfold APIs for a link that names the domain", async () => {
    const fetch = site({ "https://explore.jobs.netflix.net/api/apply/v2/jobs": eightfoldList });
    const found = await discoverBoard(
      { name: "Netflix", url: "https://explore.jobs.netflix.net/careers?domain=netflix.com" },
      { fetch },
    );
    expect(found).toMatchObject({ token: "explore.jobs.netflix.net|netflix.com", openJobs: 2 });
  });

  it("gives up when nothing turns up", async () => {
    expect(await discoverBoard({ name: "Nobody Inc", url: "" }, { fetch: site({}) })).toBeNull();
  });
});
