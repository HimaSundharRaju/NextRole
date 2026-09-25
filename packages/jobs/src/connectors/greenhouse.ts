import { inferWorkplaceType, parseSalaryFromText } from "../normalize";
import { decodeEntities, htmlToText } from "../sanitize";
import { getJson } from "./http";
import type { BoardConnector, NormalizedJob, NormalizedSalary } from "./types";

// https://developers.greenhouse.io/job-board.html
interface GreenhouseJob {
  id: number;
  title: string;
  updated_at?: string;
  first_published?: string | null;
  absolute_url: string;
  content?: string;
  location?: { name?: string | null } | null;
  departments?: Array<{ name?: string | null }>;
  offices?: Array<{ name?: string | null; location?: string | null }>;
  metadata?: Array<{ name?: string; value?: unknown }> | null;
  pay_input_ranges?: Array<{
    min_cents?: number | null;
    max_cents?: number | null;
    currency_type?: string | null;
    title?: string | null;
  }>;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

function salaryFrom(job: GreenhouseJob, text: string): NormalizedSalary | null {
  const range = job.pay_input_ranges?.find((item) => item.min_cents || item.max_cents);
  if (range) {
    return {
      min: range.min_cents ? Math.round(range.min_cents / 100) : null,
      max: range.max_cents ? Math.round(range.max_cents / 100) : null,
      currency: range.currency_type ?? "USD",
      period: "year",
    };
  }
  return parseSalaryFromText(text);
}

function metadataText(job: GreenhouseJob): string {
  return (job.metadata ?? [])
    .map((item) => (typeof item.value === "string" ? item.value : ""))
    .join(" ");
}

export function mapGreenhouseJob(job: GreenhouseJob): NormalizedJob {
  const html = decodeEntities(job.content ?? "");
  const text = htmlToText(html);
  const location = job.location?.name?.trim() ?? "";
  const published = job.first_published ?? job.updated_at;
  return {
    externalId: String(job.id),
    title: job.title.trim(),
    department:
      job.departments
        ?.map((dept) => dept.name)
        .filter(Boolean)
        .join(", ") ?? "",
    location,
    workplaceType: inferWorkplaceType([location, metadataText(job), text.slice(0, 600)]),
    employmentType: "",
    descriptionHtml: html,
    applyUrl: job.absolute_url,
    postedAt: published ? new Date(published) : null,
    salary: salaryFrom(job, text),
  };
}

export const greenhouse: BoardConnector = {
  provider: "greenhouse",
  boardUrl: (token) => `https://job-boards.greenhouse.io/${encodeURIComponent(token)}`,
  async listJobs(token, context) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true&pay_transparency=true`;
    const data = await getJson<GreenhouseResponse>(url, context);
    return (data.jobs ?? []).map(mapGreenhouseJob);
  },
};
