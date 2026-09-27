import { describe, expect, it } from "vitest";
import { quickMatch, titleSimilarity, type CandidateSignals, type JobSignals } from "./match";

const candidate: CandidateSignals = {
  skills: ["python", "go", "kubernetes", "aws", "postgresql", "apache kafka"],
  targetTitles: ["Backend Engineer"],
  targetLocations: ["San Francisco, CA"],
  remotePreference: "any",
  seniority: "senior",
  minSalary: 160000,
};

const job: JobSignals = {
  title: "Senior Backend Engineer, Payments",
  skills: ["go", "kubernetes", "aws", "postgresql", "grpc"],
  location: "Remote — US",
  workplaceType: "remote",
  salaryMax: 215000,
  salaryPeriod: "year",
};

describe("titleSimilarity", () => {
  it("ignores seniority words and expands synonyms", () => {
    expect(titleSimilarity("Senior Backend Engineer", "Backend Engineer")).toBe(1);
    expect(titleSimilarity("Sr. Back-End Developer", "Backend Engineer")).toBe(1);
    expect(titleSimilarity("Product Designer", "Backend Engineer")).toBe(0);
  });
});

describe("quickMatch", () => {
  it("scores a strong match highly with reasons", () => {
    const result = quickMatch(candidate, job);
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.matchedSkills).toEqual(["go", "kubernetes", "aws", "postgresql"]);
    expect(result.missingSkills).toEqual(["grpc"]);
    expect(result.reasons).toEqual(
      expect.arrayContaining(["4/5 skills match", "Remote role", "Meets your salary floor"]),
    );
  });

  it("penalizes pay below the candidate's floor", () => {
    const low = quickMatch(candidate, { ...job, salaryMax: 120000 });
    expect(low.score).toBeLessThan(quickMatch(candidate, job).score);
    expect(low.reasons).toContain("Pays below your minimum");
  });

  it("penalizes senior titles for entry-level candidates", () => {
    const junior = quickMatch({ ...candidate, seniority: "entry" }, job);
    expect(junior.score).toBeLessThan(quickMatch(candidate, job).score);
  });

  it("trusts the level and years enrichment read over the title", () => {
    const entry = { ...candidate, seniority: "entry" as const };
    const plainTitle = { ...job, title: "Backend Engineer, Payments" };
    // The title says nothing, but the post asks for six years.
    const asksYears = quickMatch(entry, { ...plainTitle, yearsMin: 6 });
    expect(asksYears.score).toBe(quickMatch(entry, plainTitle).score - 20);
    expect(asksYears.reasons).toContain("Asks for 6+ years");
    // An "Associate" title that enrichment read as a mid-level role isn't junior.
    const associate = { ...job, title: "Associate Backend Engineer" };
    expect(quickMatch(candidate, { ...associate, seniority: "mid" }).score).toBe(
      quickMatch(candidate, associate).score + 15,
    );
    // Mid-level candidates lose a little for roles asking for eight years or more.
    const mid = { ...candidate, seniority: "mid" as const };
    expect(quickMatch(mid, { ...plainTitle, yearsMin: 8 }).score).toBe(
      quickMatch(mid, plainTitle).score - 10,
    );
  });

  it("scores unrelated roles low", () => {
    const result = quickMatch(candidate, {
      title: "Account Executive",
      skills: ["salesforce", "b2b sales"],
      location: "Chicago, IL",
      workplaceType: "onsite",
      salaryMax: null,
      salaryPeriod: null,
    });
    expect(result.score).toBeLessThan(20);
  });

  it("respects a remote-only preference", () => {
    const remoteOnly = { ...candidate, remotePreference: "remote" as const };
    const onsite = quickMatch(remoteOnly, {
      ...job,
      workplaceType: "onsite",
      location: "Chicago, IL",
    });
    expect(onsite.score).toBeLessThan(quickMatch(remoteOnly, job).score);
  });
});
