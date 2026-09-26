import { emptyResume } from "@gettargetrole/resume/schema";
import { describe, expect, it } from "vitest";
import { connectionConfig } from "./client";
import {
  AUTO_PREPARE_DAILY_MAX,
  MONTHLY_AI_BUDGET_USD,
  nextPlanWithMore,
  PLAN_LIMITS,
  PLAN_ORDER,
  USAGE_UNITS,
} from "./plans";
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

describe("plan limits", () => {
  it("never give a higher plan less of anything than a lower one", () => {
    for (const unit of USAGE_UNITS) {
      const limits = PLAN_ORDER.map((plan) => PLAN_LIMITS[plan][unit]);
      expect(limits, unit).toEqual([...limits].sort((a, b) => a - b));
    }
    const budgets = PLAN_ORDER.map((plan) => MONTHLY_AI_BUDGET_USD[plan]);
    expect(budgets).toEqual([...budgets].sort((a, b) => a - b));
  });

  it("keeps the free plan to the job board, imports and a few Studio edits", () => {
    const paid = USAGE_UNITS.filter((unit) => PLAN_LIMITS.free[unit] > 0);
    expect(paid).toEqual(["import", "studio"]);
    expect(AUTO_PREPARE_DAILY_MAX.free).toBe(0);
    expect(AUTO_PREPARE_DAILY_MAX.plus).toBe(0);
  });

  it("gives auto-prepare a monthly allowance that covers the daily maximum", () => {
    for (const plan of PLAN_ORDER) {
      expect(PLAN_LIMITS[plan].auto).toBeGreaterThanOrEqual(AUTO_PREPARE_DAILY_MAX[plan] * 30);
    }
  });

  it("suggests the cheapest plan with more of a unit", () => {
    expect(nextPlanWithMore("free", "tailor")).toBe("plus");
    expect(nextPlanWithMore("plus", "auto")).toBe("pro");
    expect(nextPlanWithMore("pro", "tailor")).toBe("concierge");
    expect(nextPlanWithMore("concierge", "tailor")).toBeNull();
  });
});
