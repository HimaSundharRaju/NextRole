import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago" style timestamps. */
export function timeAgo(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return "";
  const value = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.round((value.getTime() - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const value = typeof date === "string" ? new Date(date) : date;
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const compactMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: amount >= 10_000 ? "compact" : "standard",
    minimumFractionDigits: 0,
    maximumFractionDigits: amount >= 10_000 || Number.isInteger(amount) ? 0 : 2,
  }).format(amount);

export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null,
): string | null {
  if (min === null && max === null) return null;
  const code = currency ?? "USD";
  const suffix = period === "hour" ? "/hr" : period === "month" ? "/mo" : "";
  try {
    if (min !== null && max !== null && min !== max) {
      return `${compactMoney(min, code)} – ${compactMoney(max, code)}${suffix}`;
    }
    return `${compactMoney((max ?? min)!, code)}${suffix}`;
  } catch {
    return null;
  }
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count} ${count === 1 ? word : pluralWord}`;
}
