import { skillLabel } from "@nextrole/resume/skills";
import { Building2, Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { Badge, MatchBadge } from "@/components/ui/badge";
import { formatSalary, timeAgo } from "@/lib/utils";
import type { JobListItem } from "@/server/data/jobs";
import { SaveJobButton } from "./save-job-button";

const WORKPLACE_LABEL: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  unknown: "",
};

const STATUS_LABEL: Record<string, string> = {
  saved: "Saved",
  preparing: "Preparing",
  applied: "Applied",
  screening: "Screening",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Closed",
  withdrawn: "Withdrawn",
};

export function JobCard({ job, compact = false }: { job: JobListItem; compact?: boolean }) {
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod);

  return (
    <article className="group relative rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">
            <Link
              href={`/jobs/${job.id}`}
              className="after:absolute after:inset-0 hover:text-primary"
            >
              {job.title}
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" aria-hidden />
              {job.companyName}
            </span>
            {job.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                <span className="line-clamp-1">{job.location}</span>
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {timeAgo(job.firstSeenAt)}
            </span>
          </p>
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-2">
          <MatchBadge score={job.match.score} />
          {!compact ? (
            <SaveJobButton jobId={job.id} saved={Boolean(job.applicationStatus)} />
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {job.isNew ? <Badge tone="success">New</Badge> : null}
        {WORKPLACE_LABEL[job.workplaceType] ? (
          <Badge tone="outline">{WORKPLACE_LABEL[job.workplaceType]}</Badge>
        ) : null}
        {salary ? <Badge tone="outline">{salary}</Badge> : null}
        {job.applicationStatus ? (
          <Badge tone="primary">
            {STATUS_LABEL[job.applicationStatus] ?? job.applicationStatus}
          </Badge>
        ) : null}
        {!compact
          ? job.match.matchedSkills.slice(0, 5).map((skill) => (
              <span
                key={skill}
                className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {skillLabel(skill)}
              </span>
            ))
          : null}
      </div>
      {!compact && job.match.reasons.length ? (
        <p className="mt-2 text-xs text-muted-foreground">{job.match.reasons.join(" · ")}</p>
      ) : null}
    </article>
  );
}
