import "server-only";
import type { JobContext } from "@gettargetrole/ai";
import { NotFoundError } from "@gettargetrole/core/errors";
import {
  applications,
  companies,
  EMPLOYMENT_TYPES,
  getDb,
  jobMatches,
  jobs,
  resumeHash,
  resumes,
  type EmploymentType,
  type VisaSponsorship,
  type WorkplaceType,
} from "@gettargetrole/db";
import { quickMatch, type QuickMatch } from "@gettargetrole/jobs/match";
import {
  and,
  arrayContains,
  arrayOverlaps,
  desc,
  eq,
  gte,
  isNull,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { SALARY_CURRENCIES, VISA_FILTERS, type VisaFilter } from "@/lib/job-labels";
import { candidateSignals, getProfile } from "./profile";
import { getPrimaryResume } from "./resumes";

const blankToUndefined = (value: unknown) => (value === "" ? undefined : value);
const yearlyAmount = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().min(1).max(100_000_000).optional().catch(undefined),
);

export const jobFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  workplace: z.enum(["any", "remote", "hybrid", "onsite"]).optional().catch(undefined),
  posted: z.enum(["any", "24h", "3d", "7d", "30d"]).optional().catch(undefined),
  sort: z.enum(["match", "newest"]).optional().catch(undefined),
  /** Hide jobs that match the user's resume less well than this. */
  minMatch: z.enum(["60", "70", "80"]).optional().catch(undefined),
  company: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100).optional().catch(undefined),
  /** ISO country code, e.g. "US". */
  country: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional()
      .catch(undefined),
  ),
  /** ISO state/province code, e.g. "US-CA". */
  region: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/)
      .optional()
      .catch(undefined),
  ),
  /** Employment types; a job matches if it has any of them. */
  type: z.preprocess(
    (value) => (value === undefined ? undefined : [value].flat()),
    z
      .array(z.string())
      .transform((values) =>
        values.filter((value): value is EmploymentType =>
          (EMPLOYMENT_TYPES as readonly string[]).includes(value),
        ),
      )
      .optional()
      .catch(undefined),
  ),
  /** Yearly pay range; jobs without a salary in this currency are left out when set. */
  salaryMin: yearlyAmount,
  salaryMax: yearlyAmount,
  currency: z.enum(SALARY_CURRENCIES).optional().catch(undefined),
  /** Unset means the user's profile decides: people who need sponsorship get "open". */
  visa: z.enum(VISA_FILTERS).optional().catch(undefined),
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
  employmentTypes: jobs.employmentTypes,
  visaSponsorship: jobs.visaSponsorship,
  citizenshipRequired: jobs.citizenshipRequired,
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
  employmentTypes: EmploymentType[];
  visaSponsorship: VisaSponsorship;
  citizenshipRequired: boolean;
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
  /** The visa filter applied, after the profile default. */
  visa: VisaFilter;
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
  if (filters.country) conditions.push(arrayContains(jobs.countries, [filters.country]));
  if (filters.region) conditions.push(arrayContains(jobs.regions, [filters.region]));
  if (filters.type?.length) conditions.push(arrayOverlaps(jobs.employmentTypes, filters.type));
  if (filters.salaryMin || filters.salaryMax) {
    conditions.push(eq(jobs.salaryCurrency, filters.currency ?? "USD"));
    // A range such as 140-180k matches a floor of 150k: it can reach it.
    const top = sql`coalesce(${jobs.salaryAnnualMax}, ${jobs.salaryAnnualMin})`;
    const bottom = sql`coalesce(${jobs.salaryAnnualMin}, ${jobs.salaryAnnualMax})`;
    if (filters.salaryMin) conditions.push(gte(top, filters.salaryMin));
    if (filters.salaryMax) conditions.push(lte(bottom, filters.salaryMax));
  }
  if (filters.visa === "open") {
    // Posts that don't mention sponsorship stay visible.
    conditions.push(ne(jobs.visaSponsorship, "no"), eq(jobs.citizenshipRequired, false));
  } else if (filters.visa === "offers") {
    conditions.push(eq(jobs.visaSponsorship, "yes"));
  }
  return conditions;
}

/** The visa filter to apply: the one chosen, else "open" for people who need sponsorship. */
async function visaFilterFor(userId: string, chosen: VisaFilter | undefined): Promise<VisaFilter> {
  if (chosen) return chosen;
  return (await getProfile(userId)).needsSponsorship ? "open" : "any";
}

/**
 * Open jobs matching the filters. "Best match" ranks the most recent candidates with the
 * deterministic scorer; "Newest" pages straight from the database.
 */
export async function searchJobs(userId: string, chosen: JobFilters): Promise<JobSearchResult> {
  const db = getDb();
  const [signals, visa] = await Promise.all([
    candidateSignals(userId),
    visaFilterFor(userId, chosen.visa),
  ]);
  const filters = { ...chosen, visa };
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

  if (sort === "newest" && !filters.minMatch) {
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
      visa,
    };
  }

  // Match scores come from the resume, not SQL, so ranking and a minimum match work on the most
  // relevant (or newest) candidates.
  const ranking =
    filters.q && sort === "match"
      ? sql`ts_rank(${jobs.searchVector}, websearch_to_tsquery('english', ${filters.q})) desc`
      : desc(jobs.firstSeenAt);
  const candidates = await base.orderBy(ranking).limit(MATCH_CANDIDATES);
  const minMatch = Number(filters.minMatch ?? 0);
  const scored = candidates.map(score).filter((job) => job.match.score >= minMatch);
  if (sort === "match") scored.sort((a, b) => b.match.score - a.match.score);
  const considered = scored.length;
  return {
    items: scored.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    total: considered,
    page,
    pageCount: Math.max(1, Math.ceil(considered / PAGE_SIZE)),
    capped: total > considered,
    visa,
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

  const [signals, [aiMatch], [application], primary] = await Promise.all([
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
    getPrimaryResume(userId),
  ]);
  const [tailored] = application?.resumeId
    ? await db
        .select({ sourceHash: resumes.sourceHash, notes: resumes.tailorNotes })
        .from(resumes)
        .where(and(eq(resumes.id, application.resumeId), eq(resumes.userId, userId)))
        .limit(1)
    : [];
  // Known to be made from an older main resume; resumes from before hashes existed aren't flagged.
  const mainHash = primary ? resumeHash(primary.content) : null;
  const madeFromOlder = (hash: string | null | undefined) =>
    Boolean(hash && mainHash && hash !== mainHash);

  return {
    job: row.job,
    company: { name: row.companyName, slug: row.companySlug, website: row.companyWebsite },
    match: quickMatch(signals, row.job),
    aiMatch: aiMatch ?? null,
    aiMatchStale: madeFromOlder(aiMatch?.sourceHash),
    application: application ?? null,
    tailored: tailored
      ? { notes: tailored.notes, stale: madeFromOlder(tailored.sourceHash) }
      : null,
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

export interface Facet {
  code: string;
  count: number;
}

/** Countries with open jobs and, for a chosen country, its states or provinces. */
export async function locationFacets(
  country?: string,
): Promise<{ countries: Facet[]; regions: Facet[] }> {
  const db = getDb();
  const open = sql`${jobs.closedAt} is null`;
  const countries = await db.execute<{ code: string; count: number }>(
    sql`select code, count(*)::int as count from ${jobs}, unnest(${jobs.countries}) as code
        where ${open} group by code order by count desc`,
  );
  const regions = country
    ? await db.execute<{ code: string; count: number }>(
        sql`select code, count(*)::int as count from ${jobs}, unnest(${jobs.regions}) as code
            where ${open} and code like ${`${country}-%`} group by code order by count desc`,
      )
    : { rows: [] };
  return { countries: countries.rows, regions: regions.rows };
}

export async function listCompaniesForFilter() {
  return getDb()
    .select({ slug: companies.slug, name: companies.name, openJobCount: companies.openJobCount })
    .from(companies)
    .where(sql`${companies.openJobCount} > 0`)
    .orderBy(companies.name);
}
