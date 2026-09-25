import type { WorkplaceType } from "@nextrole/db/schema";
import { inferWorkplaceType, parseSalaryFromText } from "../normalize";
import { htmlToText } from "../sanitize";
import { getJson } from "./http";
import type { BoardConnector, NormalizedJob, NormalizedSalary } from "./types";

// https://developers.ashbyhq.com/docs/public-job-posting-api
interface AshbyJob {
  id: string;
  title: string;
  department?: string | null;
  team?: string | null;
  employmentType?: string | null;
  location?: string | null;
  secondaryLocations?: Array<{ location?: string | null }>;
  publishedAt?: string | null;
  isListed?: boolean;
  isRemote?: boolean | null;
  workplaceType?: string | null;
  jobUrl: string;
  applyUrl?: string | null;
  descriptionHtml?: string | null;
  compensation?: {
    summaryComponents?: Array<{
      compensationType?: string;
      interval?: string;
      currencyCode?: string | null;
      minValue?: number | null;
      maxValue?: number | null;
    }>;
  } | null;
}

interface AshbyResponse {
  jobs: AshbyJob[];
}

const ASHBY_WORKPLACE: Record<string, WorkplaceType> = {
  remote: "remote",
  hybrid: "hybrid",
  onsite: "onsite",
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  FullTime: "Full-time",
  PartTime: "Part-time",
  Intern: "Internship",
  Contract: "Contract",
  Temporary: "Temporary",
};

function salaryFrom(job: AshbyJob, text: string): NormalizedSalary | null {
  const salary = job.compensation?.summaryComponents?.find(
    (component) =>
      component.compensationType === "Salary" && (component.minValue || component.maxValue),
  );
  if (salary) {
    const interval = (salary.interval ?? "").toUpperCase();
    return {
      min: salary.minValue ?? null,
      max: salary.maxValue ?? null,
      currency: salary.currencyCode ?? "USD",
      period: interval.includes("HOUR") ? "hour" : interval.includes("MONTH") ? "month" : "year",
    };
  }
  return parseSalaryFromText(text);
}

export function mapAshbyJob(job: AshbyJob): NormalizedJob {
  const html = job.descriptionHtml ?? "";
  const text = htmlToText(html);
  const locations = [job.location, ...(job.secondaryLocations ?? []).map((item) => item.location)]
    .filter((value): value is string => Boolean(value))
    .join(" / ");
  const declared = ASHBY_WORKPLACE[(job.workplaceType ?? "").toLowerCase().replace(/[^a-z]/g, "")];
  return {
    externalId: job.id,
    title: job.title.trim(),
    department: [job.department, job.team].filter(Boolean).join(" · "),
    location: locations,
    workplaceType:
      declared ?? (job.isRemote ? "remote" : inferWorkplaceType([locations, text.slice(0, 600)])),
    employmentType: EMPLOYMENT_LABELS[job.employmentType ?? ""] ?? job.employmentType ?? "",
    descriptionHtml: html,
    applyUrl: job.applyUrl ?? job.jobUrl,
    postedAt: job.publishedAt ? new Date(job.publishedAt) : null,
    salary: salaryFrom(job, text),
  };
}

export const ashby: BoardConnector = {
  provider: "ashby",
  boardUrl: (token) => `https://jobs.ashbyhq.com/${encodeURIComponent(token)}`,
  async listJobs(token, context) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
    const data = await getJson<AshbyResponse>(url, context);
    return (data.jobs ?? []).filter((job) => job.isListed !== false).map(mapAshbyJob);
  },
};
