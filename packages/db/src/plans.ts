import type { Plan } from "./schema/auth";

/*
 * Plan allowances and spend caps, shared by the web app and the worker. No imports beyond types,
 * so UI code can use them without pulling in the database client.
 */

/** What a monthly allowance counts. One unit is one new AI-made artifact; reuse is free. */
export const USAGE_UNITS = [
  "import",
  "tailor",
  "letter",
  "answers",
  "outreach",
  "fit",
  "interview",
  "studio",
  "auto",
] as const;
export type UsageUnit = (typeof USAGE_UNITS)[number];

/** Plans from least to most generous, for upgrade suggestions. */
export const PLAN_ORDER: readonly Plan[] = ["free", "plus", "pro", "concierge"];

/** Units each plan includes per calendar month (UTC). */
export const PLAN_LIMITS: Record<Plan, Record<UsageUnit, number>> = {
  free: {
    import: 2,
    tailor: 0,
    letter: 0,
    answers: 0,
    outreach: 0,
    fit: 0,
    interview: 0,
    studio: 10,
    auto: 0,
  },
  plus: {
    import: 5,
    tailor: 40,
    letter: 40,
    answers: 40,
    outreach: 20,
    fit: 100,
    interview: 5,
    studio: 100,
    auto: 0,
  },
  pro: {
    import: 10,
    tailor: 100,
    letter: 100,
    answers: 100,
    outreach: 60,
    fit: 300,
    interview: 20,
    studio: 200,
    auto: 90,
  },
  concierge: {
    import: 30,
    tailor: 600,
    letter: 600,
    answers: 600,
    outreach: 300,
    fit: 1000,
    interview: 100,
    studio: 1000,
    auto: 750,
  },
};

/** Most applications auto-prepare may make in a day; 0 means the plan doesn't include it. */
export const AUTO_PREPARE_DAILY_MAX: Record<Plan, number> = {
  free: 0,
  plus: 0,
  pro: 3,
  concierge: 25,
};

/**
 * Monthly cap on AI spend per plan, in USD: a backstop set just above the cost of using every
 * allowance, so it only stops outliers. It applies to the web app and the worker alike.
 */
export const MONTHLY_AI_BUDGET_USD: Record<Plan, number> = {
  free: 0.5,
  plus: 9,
  pro: 25,
  concierge: 120,
};

/**
 * Auto-prepare stops once this share of the month's budget is used, so the rest stays available
 * for the user's own requests.
 */
export const AUTO_PREPARE_BUDGET_SHARE = 0.8;

/** Below this match score, AI work on a job asks for confirmation first. */
export const MIN_AI_MATCH = 70;

/** The cheapest plan that includes more of `unit` than `plan` does, if any. */
export function nextPlanWithMore(plan: Plan, unit: UsageUnit): Plan | null {
  const current = PLAN_LIMITS[plan][unit];
  return PLAN_ORDER.find((candidate) => PLAN_LIMITS[candidate][unit] > current) ?? null;
}
