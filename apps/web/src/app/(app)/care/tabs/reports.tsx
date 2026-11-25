import { getDb, recentlyHiddenJobs, reportQueue } from "@gettargetrole/db";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { JOB_REPORT_REASON_LABEL } from "@/lib/job-labels";
import { cn, formatDate, plural, timeAgo } from "@/lib/utils";
import { ReportActions, ShowAgainButton } from "../queue-client";

const VIEWS = [
  { hidden: false, label: "Needs review", href: "/care?tab=reports" },
  { hidden: true, label: "Recently hidden", href: "/care?tab=reports&hidden=1" },
] as const;

/** Jobs people flagged, to keep (they're real) or hide; and the last month's hides, to undo. */
export async function ReportsTab({ showHidden }: { showHidden: boolean }) {
  const db = getDb();
  return (
    <div className="space-y-4">
      <nav className="flex gap-2 text-xs" aria-label="Report views">
        {VIEWS.map((view) => (
          <Link
            key={view.label}
            href={view.href}
            className={cn(
              "rounded-full border px-3 py-1",
              view.hidden === showHidden ? "border-primary text-primary" : "border-border",
            )}
          >
            {view.label}
          </Link>
        ))}
      </nav>
      {showHidden ? <HiddenJobs jobs={await recentlyHiddenJobs(db, {})} /> : null}
      {showHidden ? null : <ReportedJobs jobs={await reportQueue(db)} />}
    </div>
  );
}

function ReportedJobs({ jobs }: { jobs: Awaited<ReturnType<typeof reportQueue>> }) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        Nothing to review.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {jobs.map((job) => (
        <li key={job.jobId}>
          <Card>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/jobs/${job.jobId}`} className="font-medium hover:underline">
                    {job.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {job.companyName}
                    {job.location ? ` · ${job.location}` : ""}
                    {job.postedAt ? ` · posted ${formatDate(job.postedAt)}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="warning">{plural(job.reports, "report")}</Badge>
                  <Badge tone="outline">Ghost score {job.ghostScore}</Badge>
                </div>
              </div>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {Object.entries(job.reasons).map(([reason, count]) => (
                  <span key={reason}>
                    {JOB_REPORT_REASON_LABEL[reason as keyof typeof JOB_REPORT_REASON_LABEL]} ×
                    {count}
                  </span>
                ))}
                <span>first reported {timeAgo(job.firstReportedAt)}</span>
              </p>
              {job.notes.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {job.notes.map((note, index) => (
                    <li key={index} className="border-l-2 border-border pl-3 text-muted-foreground">
                      {note}
                    </li>
                  ))}
                </ul>
              ) : null}
              <a
                href={job.applyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary"
              >
                The employer&apos;s posting <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
              <ReportActions jobId={job.jobId} />
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function HiddenJobs({ jobs }: { jobs: Awaited<ReturnType<typeof recentlyHiddenJobs>> }) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        Nothing hidden in the last 30 days.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {jobs.map((job) => (
        <li key={job.jobId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0 text-sm">
            <Link href={`/jobs/${job.jobId}`} className="font-medium hover:underline">
              {job.title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {job.companyName} · hidden {timeAgo(job.hiddenAt)}
              {job.hiddenByName ? ` by ${job.hiddenByName}` : ""}
            </p>
            <p className="text-xs">{job.hiddenReason}</p>
          </div>
          <ShowAgainButton jobId={job.jobId} />
        </li>
      ))}
    </ul>
  );
}
