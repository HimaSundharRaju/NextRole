import {
  AUTO_PREPARE_DAILY_MAX,
  MONTHLY_AI_BUDGET_USD,
  nextPlanWithMore,
  PLAN_LIMITS,
  type UsageUnit,
} from "@gettargetrole/db/plans";
import type { Plan } from "@gettargetrole/db/schema";

export interface PlanDefinition {
  id: Plan;
  name: string;
  priceUsd: number;
  tagline: string;
  /** Monthly cap on AI spend per user, which bounds cost and abuse. */
  monthlyAiBudgetUsd: number;
  features: string[];
}

export const PLANS: Record<Plan, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    tagline: "Find matched jobs and apply on your own.",
    monthlyAiBudgetUsd: MONTHLY_AI_BUDGET_USD.free,
    features: [
      "Live job board with match scores against your resume",
      "Filters for location, pay, W-2/C2C and visa sponsorship",
      "Manual apply, tracker and job alerts",
      `${PLAN_LIMITS.free.import} resume imports and ${PLAN_LIMITS.free.studio} Studio edits a month`,
    ],
  },
  plus: {
    id: "plus",
    name: "Plus",
    priceUsd: 12,
    tagline: "Tailor your resume for the jobs you choose.",
    monthlyAiBudgetUsd: MONTHLY_AI_BUDGET_USD.plus,
    features: [
      "Everything in Free",
      `${PLAN_LIMITS.plus.tailor} tailored resumes and cover letters a month`,
      "Tailor to any job description you paste",
      "Application answers and recruiter outreach",
      `${PLAN_LIMITS.plus.studio} Studio messages a month`,
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 29,
    tagline: "Your best new matches, prepared for you every day.",
    monthlyAiBudgetUsd: MONTHLY_AI_BUDGET_USD.pro,
    features: [
      "Everything in Plus",
      `${PLAN_LIMITS.pro.tailor} tailored resumes and cover letters a month`,
      `Auto-prepare up to ${AUTO_PREPARE_DAILY_MAX.pro} applications a day`,
      "Interview prep",
      `${PLAN_LIMITS.pro.studio} Studio messages a month`,
    ],
  },
  concierge: {
    id: "concierge",
    name: "Concierge",
    priceUsd: 299,
    tagline: "A dedicated specialist applies alongside you.",
    monthlyAiBudgetUsd: MONTHLY_AI_BUDGET_USD.concierge,
    features: [
      "Everything in Pro",
      "Dedicated application specialist",
      "25+ tailored applications a day, tracked live",
      "Weekly strategy check-ins",
    ],
  },
};

/** How each allowance is named in the app, as a plural noun. */
export const USAGE_UNIT_LABEL: Record<UsageUnit, string> = {
  import: "Resume imports",
  tailor: "Tailored resumes",
  letter: "Cover letters",
  answers: "Application answers",
  outreach: "Outreach drafts",
  fit: "AI fit analyses",
  interview: "Interview prep sheets",
  studio: "Studio messages",
  auto: "Auto-prepared applications",
};

/** Why an action is unavailable: the allowance is used up, or the plan doesn't include it. */
export function limitMessage(plan: Plan, unit: UsageUnit): string {
  const label = USAGE_UNIT_LABEL[unit].toLowerCase();
  const limit = PLAN_LIMITS[plan][unit];
  const next = nextPlanWithMore(plan, unit);
  const upgrade = next ? ` ${PLANS[next].name} includes ${PLAN_LIMITS[next][unit]} a month.` : "";
  return limit === 0
    ? `${USAGE_UNIT_LABEL[unit]} aren't included in the ${PLANS[plan].name} plan.${upgrade}`
    : `You've used all ${limit} ${label} in your plan this month.${upgrade}`;
}

export interface UnitAllowance {
  used: number;
  limit: number;
  left: number;
  /** Why the action is unavailable, when nothing is left. */
  blocked: string | null;
}

/** What the user has used and has left of every allowance this month. */
export function allowancesFor(
  plan: Plan,
  usage: Record<UsageUnit, number>,
): Record<UsageUnit, UnitAllowance> {
  return Object.fromEntries(
    Object.entries(PLAN_LIMITS[plan]).map(([unit, limit]) => {
      const used = Math.min(usage[unit as UsageUnit] ?? 0, limit);
      const left = Math.max(0, limit - used);
      return [
        unit,
        { used, limit, left, blocked: left > 0 ? null : limitMessage(plan, unit as UsageUnit) },
      ];
    }),
  ) as Record<UsageUnit, UnitAllowance>;
}

/** When this month's allowances reset: the first of next month (UTC), e.g. "Oct 1". */
export function usageResetLabel(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(next);
}
