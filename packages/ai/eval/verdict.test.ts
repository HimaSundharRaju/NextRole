import type { Resume } from "@gettargetrole/resume/schema";
import { describe, expect, it } from "vitest";
import { keptJobSkills } from "./checks";
import { barFrom, tiesBar, verifiedList, type Judged, type Scores } from "./verdict";

const judged = (claude: [number, number], gpt: [number, number]): Judged => ({
  "claude-judge": { win: claude[0], tie: 0, loss: claude[1] },
  "gpt-judge": { win: gpt[0], tie: 0, loss: gpt[1] },
});

const scores = (change: Partial<Scores> = {}): Scores => ({
  failures: 2,
  covered: 19,
  avgMs: 8_000,
  judged: judged([4, 4], [5, 3]),
  ...change,
});

describe("tying the bar", () => {
  const bar = scores({ judged: judged([0, 0], [0, 0]) });

  it("takes no more failures, no fewer job skills, speed and both judges", () => {
    expect(tiesBar(scores(), bar)).toBe(true);
    for (const worse of [
      { failures: 3 },
      { covered: 18 },
      { avgMs: 31_000 },
      { judged: judged([3, 4], [5, 3]) },
      // A judge without verdicts hasn't agreed to anything.
      { judged: judged([0, 0], [5, 3]) },
    ]) {
      expect(tiesBar(scores(worse), bar), JSON.stringify(worse)).toBe(false);
    }
  });

  it("compares coverage only where it's measured", () => {
    expect(tiesBar(scores({ covered: null }), { ...bar, covered: null })).toBe(true);
  });
});

describe("the bar", () => {
  const reference = scores();

  it("stays with the reference unless a premium model clearly beats it", () => {
    const clear = scores({ judged: judged([6, 2], [5, 3]) });
    const clearer = scores({ judged: judged([8, 0], [7, 1]) });
    expect(barFrom(reference, [clear, clearer])).toBe(clearer);
    expect(barFrom(reference, [scores({ judged: judged([4, 4], [8, 0]) })])).toBeNull();
    expect(barFrom(reference, [{ ...clearer, covered: 18 }])).toBeNull();
    expect(barFrom(reference, [{ ...clearer, avgMs: 40_000 }])).toBeNull();
  });
});

describe("the verified list", () => {
  it("holds the models that passed, cheapest first", () => {
    expect(
      verifiedList([
        { vendor: "anthropic", model: "claude-sonnet-5", eligible: true, costPerSuccessMicro: 900 },
        { vendor: "openai", model: "gpt-6-luna", eligible: false, costPerSuccessMicro: 10 },
        { vendor: "meta", model: "muse-ember-1.0", eligible: true, costPerSuccessMicro: 40 },
      ]),
    ).toEqual(["meta:muse-ember-1.0", "anthropic:claude-sonnet-5"]);
  });
});

describe("job skill coverage", () => {
  const resume = (skills: string[]): Resume => ({
    basics: {
      name: "Priya Shah",
      headline: "Backend Engineer",
      email: "priya@example.com",
      phone: "",
      location: "",
      links: [],
    },
    summary: "",
    experience: [],
    education: [],
    skills: [{ name: "Skills", items: skills }],
    projects: [],
    certifications: [],
    customSections: [],
  });
  const job = { description: "We build in Go on Kubernetes, with some Rust." };

  it("counts the job's skills the candidate has that the tailored resume keeps", () => {
    const source = resume(["Go", "Kubernetes", "PostgreSQL"]);
    expect(keptJobSkills(source, job, resume(["Go", "Kubernetes"]))).toBe(2);
    expect(keptJobSkills(source, job, resume(["Go", "PostgreSQL"]))).toBe(1);
    // A skill the candidate doesn't have never counts: adding it is a failed check instead.
    expect(keptJobSkills(source, job, resume(["Go", "Rust"]))).toBe(1);
  });
});
