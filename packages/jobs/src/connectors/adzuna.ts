import { inferWorkplaceType } from "../normalize";
import { textToHtml } from "./feed-text";
import { getJson } from "./http";
import type { BoardConnector, NormalizedJob } from "./types";

// Adzuna's job search API (developer.adzuna.com): recent jobs from many employers and boards.
// Its terms allow commercial use only for a 14-day trial without a license, every displayed ad
// must say "Jobs by Adzuna", descriptions are snippets, and the apply link must be Adzuna's.

interface AdzunaJob {
  id: string | number;
  title: string;
  description?: string;
  created?: string;
  redirect_url: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string | number;
  contract_type?: string;
  contract_time?: string;
  category?: { label?: string };
}

interface AdzunaSearch {
  count?: number;
  results?: AdzunaJob[];
}

const PAGE_SIZE = 50;
/** The free tier allows 250 requests a day; four syncs of up to 10 pages stay well inside. */
const MAX_PAGES = 10;
/** Recent jobs only: older ones have mostly been filled or reposted. */
const MAX_DAYS_OLD = 7;

const CURRENCY: Record<string, string> = {
  us: "USD",
  gb: "GBP",
  ca: "CAD",
  au: "AUD",
  in: "INR",
  sg: "SGD",
  nz: "NZD",
  za: "ZAR",
  de: "EUR",
  fr: "EUR",
  nl: "EUR",
  it: "EUR",
  es: "EUR",
  at: "EUR",
  be: "EUR",
};

/** Tokens are `country|category|terms`, e.g. `us|it-jobs|contract` or `gb||`. */
export function parseAdzunaToken(token: string) {
  const [country = "", category = "", terms = ""] = token.split("|");
  if (!/^[a-z]{2}$/.test(country)) {
    throw new Error(`An Adzuna board token is country|category|terms, got "${token}"`);
  }
  return { country, category, contract: terms === "contract", permanent: terms === "permanent" };
}

function credentials(): string {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) throw new Error("ADZUNA_APP_ID and ADZUNA_APP_KEY aren't set");
  return `app_id=${encodeURIComponent(id)}&app_key=${encodeURIComponent(key)}`;
}

export function mapAdzunaJob(country: string, job: AdzunaJob): NormalizedJob {
  const location = job.location?.display_name ?? "";
  const area = job.location?.area ?? [];
  // Adzuna estimates pay for ads that don't state it; only stated pay is shown.
  const stated = String(job.salary_is_predicted ?? "0") !== "1" && (job.salary_min ?? 0) > 0;
  const snippet = job.description ?? "";
  return {
    externalId: String(job.id),
    title: job.title.trim(),
    employer: job.company?.display_name?.trim() || "Unknown employer",
    department: job.category?.label ?? "",
    location,
    workplaceType: inferWorkplaceType([location, snippet]),
    employmentType: [job.contract_type, job.contract_time]
      .filter(Boolean)
      .map((term) => term!.replace(/_/g, "-"))
      .join(", "),
    descriptionHtml: textToHtml(snippet),
    applyUrl: job.redirect_url,
    postedAt: job.created ? new Date(job.created) : null,
    salary: stated
      ? {
          min: job.salary_min!,
          max: Math.max(job.salary_max ?? job.salary_min!, job.salary_min!),
          currency: CURRENCY[country] ?? null,
          period: "year",
        }
      : null,
    placeHints: area.length > 0 ? [{ country: area[0], region: area[1], city: area.at(-1) }] : [],
  };
}

function searchUrl(token: string, page: number, size: number): string {
  const board = parseAdzunaToken(token);
  const filters = [
    board.category ? `category=${encodeURIComponent(board.category)}` : "",
    board.contract ? "contract=1" : "",
    board.permanent ? "permanent=1" : "",
  ].filter(Boolean);
  return `https://api.adzuna.com/v1/api/jobs/${board.country}/search/${page}?${credentials()}&results_per_page=${size}&max_days_old=${MAX_DAYS_OLD}&sort_by=date${filters.map((filter) => `&${filter}`).join("")}`;
}

export const adzuna: BoardConnector = {
  provider: "adzuna",
  boardUrl: () => "https://www.adzuna.com/",
  async countJobs(token, context) {
    return (await getJson<AdzunaSearch>(searchUrl(token, 1, 1), context)).count ?? 0;
  },
  async listJobs(token, context) {
    const { country } = parseAdzunaToken(token);
    const jobs: NormalizedJob[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const results =
        (await getJson<AdzunaSearch>(searchUrl(token, page, PAGE_SIZE), context)).results ?? [];
      jobs.push(...results.map((job) => mapAdzunaJob(country, job)));
      if (results.length < PAGE_SIZE) break;
    }
    // Only the latest week is read, so missing jobs close after going unseen for a while.
    return { jobs, complete: false };
  },
};
