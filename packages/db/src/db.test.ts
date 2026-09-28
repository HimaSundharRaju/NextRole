import { emptyResume } from "@gettargetrole/resume/schema";
import { describe, expect, it } from "vitest";
import { connectionConfig } from "./client";
import { DEFAULT_COMPANIES } from "./seed-lib";
import { slugify } from "./slug";
import { resumeHash } from "./tailored";

describe("connectionConfig", () => {
  const url =
    "postgresql://postgres.ref:p%40ss@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require&application_name=nextrole";

  it("passes the URL through when no CA is configured", () => {
    expect(connectionConfig(url)).toEqual({ connectionString: url });
  });

  it("verifies against the given CA and drops SSL parameters that would override it", () => {
    const config = connectionConfig(
      url,
      "-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----",
    );
    expect(config.ssl).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----",
      rejectUnauthorized: true,
    });
    const parsed = new URL(config.connectionString!);
    expect(parsed.searchParams.has("sslmode")).toBe(false);
    expect(parsed.searchParams.get("application_name")).toBe("nextrole");
    expect(parsed.password).toBe("p%40ss");
    expect(parsed.host).toBe("aws-0-ap-south-1.pooler.supabase.com:5432");
  });
});

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

describe("resumeHash", () => {
  it("ignores key order, which jsonb changes, but not content", () => {
    const resume = { ...emptyResume(), summary: "Builds payment systems." };
    const reordered = Object.fromEntries(Object.entries(resume).reverse()) as typeof resume;
    expect(resumeHash(reordered)).toBe(resumeHash(resume));
    expect(resumeHash({ ...resume, summary: "Builds search systems." })).not.toBe(
      resumeHash(resume),
    );
  });
});
