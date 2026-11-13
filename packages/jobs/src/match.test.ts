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

/*
 * The postings below are real ones from the local dev database (employer in the comment), with the
 * skills the app extracted from them. A mid-level Python/SQL/AWS data engineer used to see the
 * single-skill hardware and research roles at 77% and Staff, Principal and Intern roles near the top.
 */

const dataEngineer: CandidateSignals = {
  skills: ["python", "sql", "aws", "apache spark", "etl", "pandas", "docker", "git"],
  targetTitles: ["Data Engineer"],
  targetLocations: [],
  remotePreference: "any",
  seniority: "mid",
  minSalary: null,
};

// The throwaway test account's profile: mid-level, targets several kinds of role, knows machine learning.
const genAiDeveloper: CandidateSignals = {
  ...dataEngineer,
  skills: [...dataEngineer.skills, "machine learning", "generative ai", "apache kafka"],
  targetTitles: ["Python Developer", "Data Engineer", "GenAI Engineer", "Software Engineer"],
};

const posting = (title: string, skills: string[], extra: Partial<JobSignals> = {}): JobSignals => ({
  title,
  skills,
  location: "San Francisco",
  workplaceType: "unknown",
  salaryMax: null,
  salaryPeriod: null,
  ...extra,
});

// Lyft
const dataEngineerRole = posting("Data Engineer", [
  "python",
  "sql",
  "apache spark",
  "airflow",
  "etl",
  "data warehousing",
  "data modeling",
  "statistics",
  "aws",
  "system design",
  "data analysis",
]);
// OpenAI: one extracted skill each
const physicalDesign = posting("Physical Design Engineer", ["python"]);
const systemsTest = posting("Systems Test Engineer, End-to-End Validation | Consumer Devices", [
  "python",
]);
const researchEngineer = posting("Research Engineer / Research Scientist, Health", [
  "machine learning",
]);

describe("quickMatch with little to go on", () => {
  it("does not give full skill credit for a single extracted skill", () => {
    const oneOfOne = quickMatch(dataEngineer, posting("Data Engineer", ["python"]));
    const fourOfFour = quickMatch(
      dataEngineer,
      posting("Data Engineer", ["python", "sql", "aws", "apache spark"]),
    );
    const noMatch = quickMatch(dataEngineer, posting("Data Engineer", ["salesforce"]));
    expect(oneOfOne.score).toBeLessThanOrEqual(fourOfFour.score - 15);
    // It still counts for something: a matching skill beats a missing one.
    expect(oneOfOne.score).toBeGreaterThan(noMatch.score);
    expect(oneOfOne.matchedSkills).toEqual(["python"]);
  });

  it("leaves the score of a job with enough skills alone", () => {
    // Four skills is enough evidence: 4/4 earns the full 50 points, as before.
    const full = quickMatch(
      dataEngineer,
      posting("Data Engineer", ["python", "sql", "aws", "git"]),
    );
    expect(full.score).toBe(92); // 50 skills + 30 title + 12 location (no target places)
  });

  it("scores unrelated single-skill roles well below a real match", () => {
    const real = quickMatch(dataEngineer, dataEngineerRole);
    expect(real.score).toBeGreaterThanOrEqual(60);
    for (const unrelated of [physicalDesign, systemsTest]) {
      const result = quickMatch(dataEngineer, unrelated);
      expect(result.score).toBeLessThan(50);
      expect(result.score).toBeLessThan(real.score);
    }
    const research = quickMatch(genAiDeveloper, researchEngineer);
    expect(research.score).toBeLessThan(50);
  });

  it("barely counts a shared 'Engineer' as a title match", () => {
    // Same single skill, same place: only the title differs. Sharing the field ("Data") earns the
    // title's 30 points; sharing only the noun used to earn half of them and now a quarter of that.
    const sharesOnlyTheNoun = quickMatch(dataEngineer, physicalDesign);
    const sharesTheField = quickMatch(dataEngineer, posting("Data Platform Engineer", ["python"]));
    expect(sharesTheField.score - sharesOnlyTheNoun.score).toBeGreaterThanOrEqual(25);
  });

  it("still trusts a role whose skills back it up, whatever it is called", () => {
    const backed = posting("Physical Design Engineer", ["python", "sql", "aws", "apache spark"]);
    expect(quickMatch(dataEngineer, backed).score).toBeGreaterThanOrEqual(70);
  });

  it("does not check the role against targets the candidate hasn't set", () => {
    const noTargets = { ...dataEngineer, targetTitles: [] };
    expect(quickMatch(noTargets, physicalDesign).score).toBe(
      quickMatch(noTargets, posting("Account Executive", ["python"])).score,
    );
  });
});

describe("quickMatch and the level a title implies", () => {
  const plain = quickMatch(dataEngineer, dataEngineerRole);
  const titled = (title: string, candidate = dataEngineer) =>
    quickMatch(candidate, { ...dataEngineerRole, title });

  it("marks senior, staff and principal roles down for a mid-level candidate", () => {
    expect(plain.score - titled("Senior Data Engineer").score).toBe(6);
    expect(plain.score - titled("Staff Data Engineer").score).toBe(15);
    expect(plain.score - titled("Principal Data Engineer").score).toBe(20);
    expect(plain.score - titled("Director of Data Engineering").score).toBeGreaterThanOrEqual(15);
  });

  it("marks internships and entry-level roles down for a mid-level candidate", () => {
    expect(plain.score - titled("Data Engineer Intern (2027)").score).toBe(25);
    expect(plain.score - titled("Data Engineer, New Grad").score).toBe(10);
  });

  it("says why", () => {
    expect(titled("Staff Data Engineer").reasons).toContain("Staff-level role");
    expect(titled("Data Engineer Intern (2027)").reasons).toContain("Internship");
    expect(plain.reasons).not.toContain("Mid-level role");
  });

  it("leaves a mid-level title and a title without a level alone", () => {
    expect(titled("Data Engineer II").score).toBe(plain.score);
    expect(titled("Data Engineer").score).toBe(plain.score);
  });

  it("names the lowest level when a title offers several", () => {
    expect(titled("Data Engineer (Mid-Level, Senior or Staff)").score).toBe(plain.score);
  });

  it("trusts the level enrichment read over the title", () => {
    const read = { ...dataEngineerRole, title: "Senior Data Engineer", seniority: "mid" as const };
    expect(quickMatch(dataEngineer, read).score).toBe(plain.score);
    const staffRead = { ...dataEngineerRole, seniority: "staff" as const };
    expect(plain.score - quickMatch(dataEngineer, staffRead).score).toBe(15);
  });

  it("does nothing for a candidate whose level is unknown", () => {
    const unknown = { ...dataEngineer, seniority: null };
    expect(titled("Staff Data Engineer", unknown).score).toBe(plain.score);
    expect(titled("Data Engineer Intern (2027)", unknown).score).toBe(plain.score);
  });

  it("does not hold a senior candidate back from staff or principal roles", () => {
    const senior = { ...dataEngineer, seniority: "senior" as const };
    const base = quickMatch(senior, dataEngineerRole).score;
    expect(titled("Staff Data Engineer", senior).score).toBe(base);
    expect(titled("Principal Data Engineer", senior).score).toBe(base);
    // ...but an internship is as far off for them as for a mid-level candidate.
    expect(base - titled("Data Engineer Intern (2027)", senior).score).toBe(25);
  });

  it("keeps an entry-level candidate off senior titles, as before", () => {
    const entry = { ...dataEngineer, seniority: "entry" as const };
    const base = quickMatch(entry, dataEngineerRole).score;
    expect(base - titled("Senior Data Engineer", entry).score).toBe(20);
    expect(base - titled("Data Engineer Intern (2027)", entry).score).toBe(0);
  });
});

describe("quickMatch ranking for a mid-level Python/SQL/AWS data engineer", () => {
  // Real postings from the dev database.
  const roles = {
    lyftDataEngineer: dataEngineerRole,
    pinterestSoftwareEngineerII: posting("Software Engineer II, Big Data, tvScientific", [
      "scala",
      "sql",
      "apache spark",
      "etl",
      "machine learning",
      "aws",
      "cross-functional collaboration",
      "recruiting",
      "communication",
    ]),
    robinhoodSeniorSoftwareEngineer: posting("Senior Software Engineer, Data Engineering", [
      "python",
      "sql",
      "apache spark",
      "airflow",
      "etl",
      "machine learning",
      "a/b testing",
      "data analysis",
    ]),
    airbnbSeniorStaff: posting("Senior Staff Data Engineer, Foundational Data", [
      "python",
      "scala",
      "sql",
      "etl",
      "technical leadership",
      "data analysis",
      "recruiting",
    ]),
    pinterestPrincipal: posting("Principal Engineer, Big Data Platform", [
      "python",
      "java",
      "go",
      "scala",
      "apache spark",
      "machine learning",
      "aws",
      "kubernetes",
      "roadmapping",
      "cross-functional collaboration",
      "recruiting",
    ]),
    figmaIntern: posting("Data Engineer Intern (2027)", [
      "python",
      "sql",
      "etl",
      "data warehousing",
      "a/b testing",
      "figma",
      "system design",
      "cross-functional collaboration",
      "data analysis",
      "communication",
    ]),
    physicalDesign,
    systemsTest,
  };
  const score = (role: JobSignals) => quickMatch(dataEngineer, role).score;

  it("puts mid-level data roles above Senior Staff, Principal and Intern roles", () => {
    const mid = Math.min(score(roles.lyftDataEngineer), score(roles.pinterestSoftwareEngineerII));
    expect(mid).toBeGreaterThan(score(roles.airbnbSeniorStaff));
    expect(mid).toBeGreaterThan(score(roles.pinterestPrincipal));
    expect(mid).toBeGreaterThan(score(roles.figmaIntern));
    expect(score(roles.lyftDataEngineer)).toBeGreaterThan(
      score(roles.robinhoodSeniorSoftwareEngineer),
    );
  });

  it("puts the unrelated single-skill roles below the data roles at the candidate's level", () => {
    const atTheirLevel = [
      roles.lyftDataEngineer,
      roles.pinterestSoftwareEngineerII,
      roles.robinhoodSeniorSoftwareEngineer,
    ].map(score);
    expect(Math.max(score(physicalDesign), score(systemsTest))).toBeLessThan(
      Math.min(...atTheirLevel),
    );
  });
});
