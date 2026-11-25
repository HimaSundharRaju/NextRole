import { describe, expect, it } from "vitest";
import { seniorityFromTitle, withinYears } from "./seniority";
import { TITLE_LEVELS } from "./test-fixtures";

/*
 * The titles (TITLE_LEVELS, in test-fixtures.ts) are copied from postings in the local dev database.
 * None of those 6,491 jobs has a level or a years figure, so the title is all there is to go on.
 */

describe("seniorityFromTitle", () => {
  it.each(TITLE_LEVELS)("reads %j as %s", (title, level) => {
    expect(seniorityFromTitle(title)).toBe(level);
  });
});

describe("withinYears", () => {
  const staff = { title: "Staff Software Engineer, Data Warehouse" };

  it("uses the years a post states over anything a title suggests", () => {
    expect(withinYears({ ...staff, yearsMin: 3 }, 5)).toBe(true);
    expect(withinYears({ ...staff, yearsMin: 9 }, 8)).toBe(false);
    expect(withinYears({ title: "Data Engineer", yearsMin: 6 }, 5)).toBe(false);
  });

  it("falls back to the level a title implies when the post gives no years", () => {
    const at = (title: string, max: number) => withinYears({ title }, max);
    expect(at("Software Engineering Intern, Android", 2)).toBe(true);
    expect(at("Data Engineer", 2)).toBe(true); // no cue: kept, as before
    expect(at("Software Engineer II, Big Data", 2)).toBe(true);
    expect(at("Senior Software Engineer, Data Engineering", 2)).toBe(false);
    expect(at("Senior Software Engineer, Data Engineering", 5)).toBe(true);
    expect(at("Staff Software Engineer, Data Warehouse", 5)).toBe(false);
    expect(at("Staff Software Engineer, Data Warehouse", 8)).toBe(true);
    expect(at("Principal Engineer, Big Data Platform", 8)).toBe(false);
    expect(at("Head of Marketing Operations", 8)).toBe(false);
    expect(at("Vice President, Global Communications", 8)).toBe(false);
  });

  it("trusts a level that enrichment read over the title", () => {
    expect(withinYears({ title: "Senior Data Engineer", seniority: "mid" }, 2)).toBe(true);
    expect(withinYears({ title: "Data Engineer", seniority: "staff" }, 5)).toBe(false);
  });
});
