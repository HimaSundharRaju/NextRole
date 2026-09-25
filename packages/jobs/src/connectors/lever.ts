import type { WorkplaceType } from "@nextrole/db/schema";
import { inferWorkplaceType, parseSalaryFromText } from "../normalize";
import { htmlToText } from "../sanitize";
import { getJson } from "./http";
import type { BoardConnector, NormalizedJob, NormalizedSalary } from "./types";

// https://github.com/lever/postings-api
interface LeverPosting {
  id: string;
  text: string;
  createdAt?: number;
  hostedUrl: string;
  applyUrl?: string;
  description?: string;
  additional?: string;
  lists?: Array<{ text?: string; content?: string }>;
  workplaceType?: string;
  categories?: {
    team?: string;
    department?: string;
    location?: string;
    commitment?: string;
    allLocations?: string[];
  };
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string } | null;
}

const LEVER_WORKPLACE: Record<string, WorkplaceType> = {
  remote: "remote",
  hybrid: "hybrid",
  onsite: "onsite",
  "on-site": "onsite",
};

function salaryFrom(posting: LeverPosting, text: string): NormalizedSalary | null {
  const range = posting.salaryRange;
  if (range && (range.min || range.max)) {
    const interval = range.interval ?? "";
    return {
      min: range.min ?? null,
      max: range.max ?? null,
      currency: range.currency ?? "USD",
      period: interval.includes("hour") ? "hour" : interval.includes("month") ? "month" : "year",
    };
  }
  return parseSalaryFromText(text);
}

export function mapLeverPosting(posting: LeverPosting): NormalizedJob {
  const sections = (posting.lists ?? [])
    .map((list) => `<h3>${list.text ?? ""}</h3><ul>${list.content ?? ""}</ul>`)
    .join("");
  const html = `${posting.description ?? ""}${sections}${posting.additional ?? ""}`;
  const text = htmlToText(html);
  const categories = posting.categories ?? {};
  const location =
    categories.allLocations && categories.allLocations.length > 1
      ? categories.allLocations.join(" / ")
      : (categories.location ?? "");
  const declared = LEVER_WORKPLACE[(posting.workplaceType ?? "").toLowerCase()];
  return {
    externalId: posting.id,
    title: posting.text.trim(),
    department: [categories.department, categories.team].filter(Boolean).join(" · "),
    location,
    workplaceType: declared ?? inferWorkplaceType([location, text.slice(0, 600)]),
    employmentType: categories.commitment ?? "",
    descriptionHtml: html,
    applyUrl: posting.applyUrl ?? posting.hostedUrl,
    postedAt: posting.createdAt ? new Date(posting.createdAt) : null,
    salary: salaryFrom(posting, text),
  };
}

export const lever: BoardConnector = {
  provider: "lever",
  boardUrl: (token) => `https://jobs.lever.co/${encodeURIComponent(token)}`,
  async listJobs(token, context) {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
    const postings = await getJson<LeverPosting[]>(url, context);
    return postings.map(mapLeverPosting);
  },
};
