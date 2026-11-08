import type { ApplicationStatus } from "@gettargetrole/db/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplyKit } from "@/components/jobs/apply-kit";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { PageHeader } from "@/components/ui/misc";
import { allowancesFor } from "@/lib/plans";
import { STATUS_META } from "@/lib/statuses";
import { monthlyUsage } from "@/server/ai";
import { canActForClient, loadClientUser } from "@/server/concierge";
import { getApplicationDetail } from "@/server/data/applications";
import { clientSetup } from "@/server/data/concierge";
import { requireRole } from "@/server/session";
import { AskClientForm, StaffNoteForm } from "../../client-panel";

export const metadata: Metadata = { title: "Apply for client" };

/** Steps staff can't submit from, and why. */
const STEP_BLOCKS: Partial<Record<ApplicationStatus, string>> = {
  proposed: "The client hasn't approved this job yet.",
  waiting_on_client: "Waiting for the client's answer before you can submit.",
  skipped: "The client skipped this job.",
};

export default async function ClientApplyPage({
  params,
}: {
  params: Promise<{ clientId: string; applicationId: string }>;
}) {
  const staff = await requireRole("specialist", "admin");
  const { clientId, applicationId } = await params;
  if (!(await canActForClient(staff, clientId))) notFound();
  const client = await loadClientUser(clientId).catch(() => notFound());
  const detail = await getApplicationDetail(clientId, applicationId, {
    includeStaffNotes: true,
  }).catch(() => notFound());
  const [setup, usage] = await Promise.all([clientSetup(clientId), monthlyUsage(clientId)]);
  const { application, job, resume } = detail;
  const applyUrl = job?.applyUrl || application.jobUrl;
  const submitBlocked = setup.consentAt
    ? (STEP_BLOCKS[application.status] ?? null)
    : "The client hasn't given consent yet, so you can't mark it submitted.";

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={`/specialist/${clientId}?tab=pipeline`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {client.name}
      </Link>
      <PageHeader
        title={application.jobTitle}
        description={`${application.companyName} · for ${client.name}`}
        actions={
          <Badge tone={STATUS_META[application.status].tone}>
            {STATUS_META[application.status].label}
          </Badge>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ApplyKit
          target={{ applicationId: application.id, clientId }}
          applyUrl={applyUrl}
          application={{
            id: application.id,
            status: application.status,
            resumeId: application.resumeId,
            coverLetter: application.coverLetter,
            answers: application.answers,
            appliedAt: application.appliedAt?.toISOString() ?? null,
          }}
          tailored={resume ? { notes: resume.tailorNotes, stale: false } : null}
          allowances={allowancesFor(client.plan, usage)}
          matchScore={100}
          submitBlocked={submitBlocked}
        />
        <div className="space-y-4">
          <Card>
            <CardHeader title="Apply with" />
            <CardBody className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Job-search email: </span>
                {setup.jobSearchEmail || "Not set up yet"}
              </p>
              <p className="text-xs text-muted-foreground">
                Employer-site passwords you create go in the team password manager, never here.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Answer bank" />
            <CardBody className="space-y-1 text-sm">
              {setup.answerBank.length === 0 ? (
                <p className="text-muted-foreground">No saved answers yet.</p>
              ) : null}
              {setup.answerBank.map((item) => (
                <div key={item.question} className="flex items-start justify-between gap-2">
                  <p className="min-w-0">
                    <span className="text-muted-foreground">{item.question}</span> {item.answer}
                  </p>
                  <CopyButton text={item.answer} label="Copy" className="shrink-0" />
                </div>
              ))}
            </CardBody>
          </Card>
          {application.status === "approved" ? (
            <Card>
              <CardBody>
                <AskClientForm clientId={clientId} applicationId={application.id} />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardBody>
              <StaffNoteForm clientId={clientId} applicationId={application.id} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
