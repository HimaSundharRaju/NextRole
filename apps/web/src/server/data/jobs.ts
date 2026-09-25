import "server-only";
import type { JobContext } from "@gettargetrole/ai";
import { NotFoundError } from "@gettargetrole/core/errors";
import {
  applications,
  companies,
  getDb,
  jobMatches,
  jobs,
  type WorkplaceType,
} from "@gettargetrole/db";
import { quickMatch, type QuickMatch } from "@gettargetrole/jobs/match";
import { and, desc, eq, gte, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { candidateSignals } from "./profile";

export const jobFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  workplace: z.enum(["any", "remote", "hybrid", "onsite"]).optional().catch(undefined),
  posted: z.enum(["any", "24h", "3d", "7d", "30d"]).optional().catch(undefined),
  sort: z.enum(["match", "newest"]).optional().catch(undefined),
  company: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
});
export type JobFilters = z.infer<typeof jobFiltersSchema>;

const PAGE_SIZE = 20;
const MATCH_CANDIDATES = 400;
const POSTED_WINDOWS: Record<string, number> = { "24h": 1, "3d": 3, "7d": 7, "30d": 30 };

const listColumns = {
  id: jobs.id,
  title: jobs.title,
  location: jobs.location,
  workplaceType: jobs.workplaceType,
  department: jobs.department,
  skills: jobs.skills,
  salaryMin: jobs.salaryMin,
  salaryMax: jobs.salaryMax,
  salaryCurrency: jobs.salaryCurrency,
  salaryPeriod: jobs.salaryPeriod,
  postedAt: jobs.postedAt,
  firstSeenAt: jobs.firstSeenAt,
  applyUrl: jobs.applyUrl,
  companyName: companies.name,
  companySlug: companies.slug,
};

export interface JobListItem {
  id: string;
  title: string;
  location: string;
  workplaceType: WorkplaceType;
  department: string;
  skills: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "year" | "month" | "hour" | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  applyUrl: string;
  companyName: string;
  companySlug: string;
  applicationStatus: string | null;
  /** First seen in the last 24 hours. */
  isNew: boolean;
  match: QuickMatch;
}

export interface JobSearchResult {
  items: JobListItem[];
  total: number;
  page: number;
  pageCount: number;
  capped: boolean;
}

function whereFor(filters: JobFilters): SQL[] {
  const conditions: SQL[] = [isNull(jobs.closedAt)];
  if (filters.q) {
    conditions.push(sql`${jobs.searchVector} @@ websearch_to_tsquery('english', ${filters.q})`);
  }
  if (filters.workplace && filters.workplace !== "any") {
    conditions.push(eq(jobs.workplaceType, filters.workplace));
  }
  const days = filters.posted ? POSTED_WINDOWS[filters.posted] : undefined;
  if (days) conditions.push(gte(jobs.firstSeenAt, new Date(Date.now() - days * 86_400_000)));
  if (filters.company) conditions.push(eq(companies.slug, filters.company));
  return conditions;
}

/**
 * Open jobs matching the filters. "Best match" ranks the most recent candidates with the
 * deterministic scorer; "Newest" pages straight from the database.
 */
export async function searchJobs(userId: string, filters: JobFilters): Promise<JobSearchResult> {
  const db = getDb();
  const signals = await candidateSignals(userId);
  const conditions = and(...whereFor(filters));
  const page = filters.page ?? 1;
  const sort = filters.sort ?? "match";

  const base = db
    .select({ ...listColumns, applicationStatus: applications.status })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
    .where(conditions);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(conditions);
  const total = countRow?.count ?? 0;

  const newSince = Date.now() - 86_400_000;
  const score = (row: Omit<JobListItem, "match" | "isNew">): JobListItem => ({
    ...row,
    isNew: row.firstSeenAt.getTime() > newSince,
    match: quickMatch(signals, row),
  });

  if (sort === "newest") {
    const rows = await base
      .orderBy(desc(jobs.firstSeenAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    return {
      items: rows.map(score),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      capped: false,
    };
  }

  const ranking = filters.q
    ? sql`ts_rank(${jobs.searchVector}, websearch_to_tsquery('english', ${filters.q})) desc`
    : desc(jobs.firstSeenAt);
  const candidates = await base.orderBy(ranking).limit(MATCH_CANDIDATES);
  const scored = candidates.map(score).sort((a, b) => b.match.score - a.match.score);
  const considered = scored.length;
  return {
    items: scored.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: considered,
    page,
    pageCount: Math.max(1, Math.ceil(considered / PAGE_SIZE)),
    capped: total > considered,
  };
}

export async function topMatches(userId: string, limit = 5): Promise<JobListItem[]> {
  const result = await searchJobs(userId, { sort: "match", posted: "7d" });
  return result.items.slice(0, limit);
}

export async function getJobDetail(userId: string, jobId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      job: jobs,
      companyName: companies.name,
      companySlug: companies.slug,
      companyWebsite: companies.website,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!row) throw new NotFoundError("Job");

  const [signals, [aiMatch], [application]] = await Promise.all([
    candidateSignals(userId),
    db
      .select()
      .from(jobMatches)
      .where(and(eq(jobMatches.userId, userId), eq(jobMatches.jobId, jobId)))
      .limit(1),
    db
      .select()
      .from(applications)
      .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)))
      .limit(1),
  ]);

  return {
    job: row.job,
    company: { name: row.companyName, slug: row.companySlug, website: row.companyWebsite },
    match: quickMatch(signals, row.job),
    aiMatch: aiMatch ?? null,
    application: application ?? null,
  };
}

export function jobContextOf(
  job: { title: string; location: string; descriptionText: string },
  companyName: string,
): JobContext {
  return {
    title: job.title,
    company: companyName,
    location: job.location,
    description: job.descriptionText,
  };
}

export async function listCompaniesForFilter() {
  return getDb()
    .select({ slug: companies.slug, name: companies.name, openJobCount: companies.openJobCount })
    .from(companies)
    .where(sql`${companies.openJobCount} > 0`)
    .orderBy(companies.name);
}
