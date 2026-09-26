import { ArrowLeft, Building2, CalendarDays, ExternalLink, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplyKit } from "@/components/jobs/apply-kit";
import { FitPanel } from "@/components/jobs/fit-panel";
import { JobTermsBadges } from "@/components/jobs/job-card";
import { SaveJobButton } from "@/components/jobs/save-job-button";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { allowancesFor } from "@/lib/plans";
import { formatSalary, timeAgo } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation";
import { monthlyUsage } from "@/server/ai";
import { getJobDetail } from "@/server/data/jobs";
import { requireOnboardedUser } from "@/server/session";

export const maxDuration = 300;

type Props = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!uuidSchema.safeParse(id).success) notFound();
  const user = await requireOnboardedUser();
  try {
    return await getJobDetail(user.id, id);
  } catch {
    notFound();
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const detail = await load(id);
  return { title: `${detail.job.title} at ${detail.company.name}` };
}

export default async function JobPage({ params }: Props) {
  const { id } = await params;
  const { job, company, match, aiMatch, aiMatchStale, application, tailored } = await load(id);
  const user = await requireOnboardedUser();
  const allowances = allowancesFor(user.plan, await monthlyUsage(user.id));
  const matchScore = aiMatch?.score ?? match.score;
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod);

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> All jobs
      </Link>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-4 w-4" aria-hidden /> {company.name}
            </span>
            {job.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-4 w-4" aria-hidden /> {job.location}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-4 w-4" aria-hidden /> Found {timeAgo(job.firstSeenAt)}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {job.closedAt ? <Badge tone="danger">No longer accepting applications</Badge> : null}
            {job.workplaceType !== "unknown" ? (
              <Badge tone="outline" className="capitalize">
                {job.workplaceType}
              </Badge>
            ) : null}
            <JobTermsBadges job={job} showFullTime />
            {salary ? <Badge tone="outline">{salary}</Badge> : null}
            {job.department ? <Badge tone="outline">{job.department}</Badge> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SaveJobButton jobId={job.id} saved={Boolean(application)} />
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "secondary" })}
          >
            View posting <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="lg:self-start">
          <CardBody className="p-6">
            {job.descriptionHtml ? (
              // Sanitized with a strict allow-list at ingestion (packages/jobs/src/sanitize.ts).
              <div
                className="job-description"
                dangerouslySetInnerHTML={{ __html: job.descriptionHtml }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                The full description is on the company&apos;s site.
              </p>
            )}
          </CardBody>
        </Card>

        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <FitPanel
            jobId={job.id}
            quick={match}
            aiMatch={aiMatch}
            stale={aiMatchStale}
            allowance={allowances.fit}
          />
          <ApplyKit
            target={{ jobId: job.id }}
            applyUrl={job.applyUrl}
            application={
              application
                ? {
                    id: application.id,
                    status: application.status,
                    resumeId: application.resumeId,
                    coverLetter: application.coverLetter,
                    answers: application.answers,
                    appliedAt: application.appliedAt?.toISOString() ?? null,
                  }
                : null
            }
            tailored={tailored}
            allowances={allowances}
            matchScore={matchScore}
          />
        </div>
      </div>
    </div>
  );
}
