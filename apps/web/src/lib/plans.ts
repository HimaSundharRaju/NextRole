import { MONTHLY_AI_BUDGET_USD } from "@gettargetrole/db/plans";
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
    name: "Starter",
    priceUsd: 0,
    tagline: "Everything you need to start a focused search.",
    monthlyAiBudgetUsd: MONTHLY_AI_BUDGET_USD.free,
    features: [
      "Real-time job feed with match scores",
      "AI resume studio",
      "~10 tailored applications a month",
      "Application tracker",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 29,
    tagline: "For an active search with dozens of tailored applications.",
    monthlyAiBudgetUsd: MONTHLY_AI_BUDGET_USD.pro,
    features: [
      "Everything in Starter",
      "~150 tailored applications a month",
      "Cover letters, answers & outreach for every job",
      "Interview prep and job alerts",
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
