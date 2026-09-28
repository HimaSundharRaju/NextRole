import { Briefcase, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ApplyModeBar } from "@/components/jobs/apply-mode-bar";
import { AUTO_PREPARE_DAILY_MAX } from "@gettargetrole/db/plans";
import { JobCard } from "@/components/jobs/job-card";
import { JobFilters } from "@/components/jobs/job-filters";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn, plural } from "@/lib/utils";
import { readyToApplyCount } from "@/server/data/applications";
import {
  jobFiltersSchema,
  listCompaniesForFilter,
  locationFacets,
  searchJobs,
  type JobFilters as Filters,
} from "@/server/data/jobs";
import { getProfile } from "@/server/data/profile";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Jobs" };

function pageHref(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page })) {
    if (value === undefined || value === "" || (key === "page" && value === 1)) continue;
    for (const item of [value].flat()) params.append(key, String(item));
  }
  const query = params.toString();
  return query ? `/jobs?${query}` : "/jobs";
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireOnboardedUser();
  const raw = await searchParams;
  const parsed = jobFiltersSchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        key,
        // Employment types repeat (?type=w2&type=c2c); every other filter takes one value.
        Array.isArray(value) && key !== "type" ? value[0] : value,
      ]),
    ),
  );
  // A state left over from another country no longer applies.
  const filters =
    parsed.region && !parsed.region.startsWith(`${parsed.country}-`)
      ? { ...parsed, region: undefined }
      : parsed;
  const [result, companies, facets, profile, readyCount] = await Promise.all([
    searchJobs(user.id, filters),
    listCompaniesForFilter(),
    locationFacets(filters.country),
    getProfile(user.id),
    readyToApplyCount(user.id),
  ]);
  const page = result.page;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Jobs"
        description="Live roles pulled straight from company career pages, ranked against your resume."
        actions={
          <Link href="/applications/new" className={buttonVariants({ variant: "secondary" })}>
            <FileText className="h-4 w-4" aria-hidden /> Tailor to a job description
          </Link>
        }
      />
      <ApplyModeBar
        autoPrepare={{
          included: AUTO_PREPARE_DAILY_MAX[user.plan] > 0,
          enabled: profile.autoPrepareEnabled,
          minScore: profile.autoPrepareMinScore,
          dailyLimit: Math.min(profile.autoPrepareDailyLimit, AUTO_PREPARE_DAILY_MAX[user.plan]),
        }}
        readyCount={readyCount}
      />
      <JobFilters
        filters={filters}
        visa={result.visa}
        companies={companies}
        countries={facets.countries}
        regions={facets.regions}
      />

      <p className="mt-5 text-sm text-muted-foreground">
        {result.total === 0
          ? "No open jobs match these filters."
          : `${plural(result.total, "job")}${result.capped ? " (top matches shown — refine your search to see more)" : ""}`}
      </p>

      <div className="mt-3 space-y-3">
        {result.items.length ? (
          result.items.map((job) => <JobCard key={job.id} job={job} />)
        ) : (
          <EmptyState
            icon={Briefcase}
            title="Nothing here yet"
            description="Try a broader search, a longer time window, or check back soon — new roles arrive every few minutes."
            action={
              <Link href="/jobs" className={buttonVariants({ variant: "secondary" })}>
                Clear filters
              </Link>
            }
          />
        )}
      </div>

      {result.pageCount > 1 ? (
        <nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
          <Link
            href={pageHref(filters, page - 1)}
            aria-disabled={page <= 1}
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              page <= 1 && "pointer-events-none opacity-50",
            )}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
          </Link>
          <span className="text-sm text-muted-foreground">
            Page {page} of {result.pageCount}
          </span>
          <Link
            href={pageHref(filters, page + 1)}
            aria-disabled={page >= result.pageCount}
            className={cn(
              buttonVariants({ variant: "secondary", size: "sm" }),
              page >= result.pageCount && "pointer-events-none opacity-50",
            )}
          >
            Next <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
