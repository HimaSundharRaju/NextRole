import { clientConcierge, getDb } from "@gettargetrole/db";
import { quickMatch } from "@gettargetrole/jobs/match";
import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FromSpecialist } from "@/components/concierge/from-specialist";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { formatSalary } from "@/lib/utils";
import { listApplications } from "@/server/data/applications";
import { candidateSignals } from "@/server/data/profile";
import { requireOnboardedUser } from "@/server/session";
import { ApplicationBoard } from "./board";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const user = await requireOnboardedUser();
  const applications = await listApplications(user.id);
  const concierge = user.plan === "concierge" ? await clientConcierge(getDb(), user.id) : null;
  const signals = concierge ? await candidateSignals(user.id) : null;
  const proposals =
    concierge && signals
      ? concierge.proposals.map((proposal) => ({
          id: proposal.id,
          jobTitle: proposal.jobTitle,
          companyName: proposal.companyName,
          location: proposal.location,
          note: proposal.note,
          proposedByName: proposal.proposedByName,
          score: proposal.job ? quickMatch(signals, proposal.job).score : null,
          pay: proposal.job
            ? formatSalary(
                proposal.job.salaryMin,
                proposal.job.salaryMax,
                proposal.job.salaryCurrency,
                proposal.job.salaryPeriod,
              )
            : null,
        }))
      : [];

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Applications"
        description="Drag cards between stages. We remind you to follow up a week after you apply."
        actions={
          <Link href="/applications/new" className={buttonVariants({ variant: "secondary" })}>
            <FileText className="h-4 w-4" aria-hidden /> Tailor to a job description
          </Link>
        }
      />
      {concierge ? (
        <FromSpecialist
          specialistName={concierge.specialist?.name ?? "your specialist"}
          proposals={proposals}
          questions={concierge.questions}
        />
      ) : null}
      <ApplicationBoard
        concierge={user.plan === "concierge"}
        items={applications.map((item) => ({
          id: item.id,
          companyName: item.companyName,
          jobTitle: item.jobTitle,
          location: item.location,
          status: item.status,
          appliedAt: item.appliedAt?.toISOString() ?? null,
          nextActionAt: item.nextActionAt?.toISOString() ?? null,
          followUpDue: item.followUpDue,
          updatedAt: item.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
