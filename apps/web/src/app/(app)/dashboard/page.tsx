import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  FileText,
  KanbanSquare,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { JobCard } from "@/components/jobs/job-card";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, ProgressBar, Stat } from "@/components/ui/misc";
import { PLANS } from "@/lib/plans";
import { formatDate } from "@/lib/utils";
import { monthlyAiSpendMicroUsd } from "@/server/ai";
import { followUpsDue, pipelineStats } from "@/server/data/applications";
import { topMatches } from "@/server/data/jobs";
import { getPrimaryResume } from "@/server/data/resumes";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Dashboard" };

const PIPELINE: Array<{ status: string; label: string }> = [
  { status: "saved", label: "Saved" },
  { status: "preparing", label: "Preparing" },
  { status: "applied", label: "Applied" },
  { status: "screening", label: "Screening" },
  { status: "interviewing", label: "Interviewing" },
  { status: "offer", label: "Offer" },
];

export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const [stats, matches, followUps, spend, primary] = await Promise.all([
    pipelineStats(user.id),
    topMatches(user.id, 5),
    followUpsDue(user.id),
    monthlyAiSpendMicroUsd(user.id),
    getPrimaryResume(user.id),
  ]);
  const budget = PLANS[user.plan].monthlyAiBudgetUsd * 1_000_000;
  const creditsUsed = Math.min(100, Math.round((spend / budget) * 100));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description="Here's where your search stands today."
        actions={
          <>
            <Link href="/jobs" className={buttonVariants({ variant: "secondary" })}>
              <Briefcase className="h-4 w-4" aria-hidden /> Browse jobs
            </Link>
            {primary ? (
              <Link href={`/resumes/${primary.id}`} className={buttonVariants()}>
                <Sparkles className="h-4 w-4" aria-hidden /> Resume Studio
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Applied this week" value={stats.appliedThisWeek} />
        <Stat label="Interviews" value={stats.interviews} />
        <Stat
          label="Response rate"
          value={stats.responseRate === null ? "—" : `${stats.responseRate}%`}
          hint="Screens, interviews & offers ÷ applications"
        />
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            AI credits used
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{creditsUsed}%</p>
          <ProgressBar value={creditsUsed} className="mt-2" />
          <p className="mt-1 text-xs text-muted-foreground">
            {PLANS[user.plan].name} plan · resets monthly
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Top matches this week"
            description="Fresh roles ranked against your resume and preferences."
            action={
              <Link
                href="/jobs"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary"
              >
                All jobs <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            }
          />
          <CardBody className="space-y-3">
            {matches.length ? (
              matches.map((job) => <JobCard key={job.id} job={job} compact />)
            ) : (
              <EmptyState
                icon={Briefcase}
                title="No new matches yet"
                description="New jobs arrive every few minutes. Broaden your target roles or locations in Settings to see more."
              />
            )}
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Pipeline"
              action={
                <Link
                  href="/applications"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary"
                >
                  Tracker <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              }
            />
            <CardBody>
              <ul className="space-y-2">
                {PIPELINE.map(({ status, label }) => (
                  <li key={status} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold tabular-nums">
                      {stats.byStatus[status as keyof typeof stats.byStatus] ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Follow-ups due" />
            <CardBody>
              {followUps.length ? (
                <ul className="space-y-3">
                  {followUps.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/applications/${item.id}`}
                        className="flex items-start gap-3 hover:text-primary"
                      >
                        <CalendarClock
                          className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                          aria-hidden
                        />
                        <span className="text-sm">
                          <span className="font-medium">{item.companyName}</span> — {item.jobTitle}
                          <span className="block text-xs text-muted-foreground">
                            Due {formatDate(item.nextActionAt)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing due. We&apos;ll remind you a week after each application.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex items-start gap-3">
              {primary ? (
                <FileText className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
              ) : (
                <KanbanSquare className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
              )}
              <div className="text-sm">
                <p className="font-medium">{primary ? primary.title : "Add your resume"}</p>
                <p className="mt-1 text-muted-foreground">
                  {primary
                    ? "Your main resume powers matching and every tailored application."
                    : "Import a resume so we can match and tailor jobs for you."}
                </p>
                <Link
                  href={primary ? `/resumes/${primary.id}` : "/resumes"}
                  className="mt-2 inline-block font-medium text-primary"
                >
                  {primary ? "Open in Resume Studio" : "Add resume"}
                </Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
