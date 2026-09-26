import type { Plan } from "./schema/auth";

/**
 * Monthly cap on AI spend per plan, in USD. It bounds cost and abuse, and applies to every AI
 * call: the web app's and the worker's background preparation alike. No imports beyond types,
 * so UI code can show it without pulling in the database client.
 */
export const MONTHLY_AI_BUDGET_USD: Record<Plan, number> = { free: 2, pro: 30, concierge: 120 };

/**
 * Auto-prepare stops once this share of the month's budget is used, so the rest stays available
 * for the user's own requests.
 */
export const AUTO_PREPARE_BUDGET_SHARE = 0.8;
