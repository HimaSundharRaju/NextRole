import type { WorkplaceType } from "@nextrole/db/schema";
import type { NormalizedSalary } from "./connectors/types";

/** Infers remote/hybrid from free text; returns `fallback` when the text says nothing. */
export function inferWorkplaceType(
  texts: Array<string | null | undefined>,
  fallback: WorkplaceType = "unknown",
): WorkplaceType {
  const joined = texts.filter(Boolean).join(" \n ");
  if (/\bhybrid\b/i.test(joined)) return "hybrid";
  if (/\b(not|no)\s+remote\b/i.test(joined)) return fallback === "remote" ? "unknown" : fallback;
  if (/\b(remote|work from home|wfh|distributed|anywhere)\b/i.test(joined)) return "remote";
  if (/\b(on-?site|in[- ]office|in person)\b/i.test(joined)) return "onsite";
  return fallback;
}

const AMOUNT = String.raw`(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*([kK])?`;
const RANGE = new RegExp(
  String.raw`([$€£])\s?${AMOUNT}\s*(?:-|–|—|to)\s*(?:[$€£]\s?)?${AMOUNT}(?:\s*(?:USD|EUR|GBP))?(?:\s*(?:per|\/|an?)\s*(hour|hr|year|yr|annum|month|mo))?`,
  "i",
);
const CURRENCY: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };

function toNumber(raw: string, thousands: string | undefined): number {
  const value = Number(raw.replace(/[,](?=\d{3})/g, "").replace(/\.(?=\d{3}(\D|$))/g, ""));
  return thousands ? value * 1000 : value;
}

/** Pulls a salary range like "$150,000 – $190,000" or "$45/hr - $60/hr" out of posting text. */
export function parseSalaryFromText(text: string): NormalizedSalary | null {
  const match = RANGE.exec(text);
  if (!match) return null;
  const [, symbol = "$", minRaw = "", minK, maxRaw = "", maxK, unit] = match;
  const min = toNumber(minRaw, minK);
  const max = toNumber(maxRaw, maxK);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null;

  let period: NormalizedSalary["period"];
  if (unit && /^(hour|hr)/i.test(unit)) period = "hour";
  else if (unit && /^(month|mo)/i.test(unit)) period = "month";
  else if (min >= 20_000) period = "year";
  else if (max < 500) period = "hour";
  else return null;

  return {
    min: Math.round(min),
    max: Math.round(max),
    currency: CURRENCY[symbol] ?? "USD",
    period,
  };
}

/** Annualized maximum, used to compare against a candidate's minimum salary. */
export function annualize(
  amount: number | null,
  period: NormalizedSalary["period"],
): number | null {
  if (amount === null || period === null) return null;
  if (period === "hour") return amount * 2080;
  if (period === "month") return amount * 12;
  return amount;
}
