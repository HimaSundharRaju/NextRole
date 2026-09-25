import { describe, expect, it } from "vitest";
import { DEFAULT_COMPANIES } from "./seed-lib";
import { slugify } from "./slug";

describe("slugify", () => {
  it("builds URL-safe slugs and folds accents", () => {
    expect(slugify("Crème Brûlée Labs")).toBe("creme-brulee-labs");
    expect(slugify("  AT&T / Mobility ")).toBe("at-t-mobility");
    expect(slugify("株式会社")).toBe("");
  });
});

describe("default companies", () => {
  // Seeding skips conflicting rows silently, so a duplicate would quietly drop a job board.
  it("have unique slugs and job boards", () => {
    const slugs = DEFAULT_COMPANIES.map((company) => slugify(company.name));
    expect(slugs.every(Boolean)).toBe(true);
    expect(new Set(slugs).size).toBe(slugs.length);

    const boards = DEFAULT_COMPANIES.map((company) => `${company.ats}:${company.boardToken}`);
    expect(new Set(boards).size).toBe(boards.length);
  });
});
