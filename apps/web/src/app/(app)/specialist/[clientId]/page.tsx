import { columnOf, getDb, markClientViewed, targetFor } from "@gettargetrole/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScaledPreview } from "@/components/resume/scaled-preview";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { STATUS_META } from "@/lib/statuses";
import { cn, timeAgo } from "@/lib/utils";
import { recordAudit } from "@/server/audit";
import { canActForClient, loadClientUser } from "@/server/concierge";
import { listApplications } from "@/server/data/applications";
import { clientSetup, clientTimeline } from "@/server/data/concierge";
import { searchJobs } from "@/server/data/jobs";
import { getProfile } from "@/server/data/profile";
import { getPrimaryResume } from "@/server/data/resumes";
import { requireRole } from "@/server/session";
import {
  AddForClientForm,
  AnswerBankEditor,
  ClientStatusSelect,
  ConfirmInboxButton,
  ExternalProposalForm,
  ProposeJobsForm,
} from "./client-panel";

export const metadata: Metadata = { title: "Client" };

const TABS = [
  { id: "find", label: "Find jobs" },
  { id: "pipeline", label: "Pipeline" },
  { id: "profile", label: "Profile" },
  { id: "timeline", label: "Timeline" },
] as const;

export default async function ClientWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const staff = await requireRole("specialist", "admin");
  const { clientId } = await params;
  const { tab = "find", q } = await searchParams;
  if (!(await canActForClient(staff, clientId))) notFound();
  const client = await loadClientUser(clientId).catch(() => notFound());
  if (staff.role === "specialist") {
    await markClientViewed(getDb(), { specialistId: staff.id, clientId });
  }
  await recordAudit({
    actorUserId: staff.id,
    action: "specialist.client.view",
    targetType: "user",
    targetId: clientId,
  });
  const setup = await clientSetup(clientId);

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/specialist" className="text-sm text-muted-foreground hover:text-foreground">
        ← Concierge board
      </Link>
      <PageHeader
        title={client.name}
        description={`${client.email} · ${client.plan} plan · target ${targetFor(setup.weeklyTargetOverride)} a week`}
      />
      <nav className="mb-4 flex gap-2 border-b border-border" aria-label="Client tabs">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/specialist/${clientId}?tab=${item.id}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === item.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "find" ? <FindTab clientId={clientId} q={q} /> : null}
      {tab === "pipeline" ? <PipelineTab clientId={clientId} /> : null}
      {tab === "profile" ? <ProfileTab clientId={clientId} setup={setup} /> : null}
      {tab === "timeline" ? <TimelineTab clientId={clientId} /> : null}
    </div>
  );
}

async function FindTab({ clientId, q }: { clientId: string; q?: string }) {
  const result = await searchJobs(clientId, { q: q || undefined, sort: "match", posted: "30d" });
  return (
    <div className="space-y-4">
      <form className="flex gap-2" action={`/specialist/${clientId}`}>
        <input type="hidden" name="tab" value="find" />
        <Input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search titles or skills"
          aria-label="Search jobs"
        />
      </form>
      <p className="text-sm text-muted-foreground">
        Ranked by this client&apos;s resume and preferences. Jobs already in their tracker
        can&apos;t be proposed again.
      </p>
      <ProposeJobsForm
        clientId={clientId}
        jobs={result.items.map((job) => ({
          id: job.id,
          title: job.title,
          companyName: job.companyName,
          location: job.location,
          score: job.match.score,
          status: job.applicationStatus
            ? (STATUS_META[job.applicationStatus as keyof typeof STATUS_META]?.label ??
              job.applicationStatus)
            : null,
        }))}
      />
      <Card>
        <CardHeader
          title="Found a job elsewhere?"
          description="Paste its description to propose it to the client."
        />
        <CardBody>
          <ExternalProposalForm clientId={clientId} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Applied somewhere else?"
          description="Log a role the client applied to outside the board."
        />
        <CardBody>
          <AddForClientForm clientId={clientId} />
        </CardBody>
      </Card>
    </div>
  );
}

async function PipelineTab({ clientId }: { clientId: string }) {
  const items = await listApplications(clientId);
  const now = new Date();
  const live = items.filter((item) => columnOf(item.status, item.appliedAt, now) !== null);
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
      {live.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2">
          <Link
            href={`/specialist/${clientId}/applications/${item.id}`}
            className="min-w-0 hover:underline"
          >
            <span className="block truncate font-medium">{item.jobTitle}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.companyName}</span>
          </Link>
          <ClientStatusSelect clientId={clientId} applicationId={item.id} status={item.status} />
        </li>
      ))}
    </ul>
  );
}

async function ProfileTab({
  clientId,
  setup,
}: {
  clientId: string;
  setup: Awaited<ReturnType<typeof clientSetup>>;
}) {
  const [profile, resume] = await Promise.all([getProfile(clientId), getPrimaryResume(clientId)]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Job-search inbox"
            description="The client's Gmail for applications, shared with you by delegation."
          />
          <CardBody className="space-y-2 text-sm">
            <p>{setup.jobSearchEmail || "Not entered yet."}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone={setup.consentAt ? "success" : "warning"}>
                {setup.consentAt ? "Consent given" : "No consent yet"}
              </Badge>
              <Badge tone={setup.accessConfirmedAt ? "success" : "warning"}>
                {setup.accessConfirmedAt ? "Access confirmed" : "Access not confirmed"}
              </Badge>
            </div>
            {setup.jobSearchEmail && !setup.accessConfirmedAt ? (
              <ConfirmInboxButton clientId={clientId} />
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Answer bank"
            description="Standard answers you reuse on every application."
          />
          <CardBody>
            <AnswerBankEditor clientId={clientId} bank={setup.answerBank} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Search preferences" />
          <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Roles: </span>
              {profile.targetTitles.join(", ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Locations: </span>
              {profile.targetLocations.join(", ") || "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Work authorization: </span>
              {profile.workAuthorization || "—"}
              {profile.needsSponsorship ? " (needs sponsorship)" : ""}
            </p>
          </CardBody>
        </Card>
      </div>
      <Card className="overflow-hidden lg:self-start">
        <CardHeader
          title="Main resume"
          description={resume ? resume.title : "The client hasn't added a resume yet."}
        />
        {resume ? (
          <ScaledPreview
            resume={resume.content}
            settings={resume.settings}
            className="max-h-[48rem] rounded-none"
          />
        ) : null}
      </Card>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: "Created",
  status_changed: "Moved",
  note: "Note",
  kit_generated: "Kit prepared",
  outreach_drafted: "Outreach drafted",
  submitted: "Submitted",
  auto_prepared: "Auto-prepared",
  proposed: "Proposed",
  approved: "Approved",
  skipped: "Skipped",
  question_asked: "Question asked",
  question_answered: "Question answered",
  staff_note: "Staff note",
};

async function TimelineTab({ clientId }: { clientId: string }) {
  const events = await clientTimeline(clientId);
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
      {events.map((event) => (
        <li key={event.id} className="px-4 py-2">
          <p>
            <span className="font-medium">{EVENT_LABEL[event.type] ?? event.type}</span>{" "}
            <span className="text-muted-foreground">
              · {event.jobTitle} at {event.companyName} · {event.actorName ?? "System"} ·{" "}
              {timeAgo(event.createdAt)}
            </span>
          </p>
          {typeof event.data.note === "string" ? (
            <p className="text-muted-foreground">{event.data.note}</p>
          ) : null}
          {typeof event.data.question === "string" ? (
            <p className="text-muted-foreground">Q: {event.data.question}</p>
          ) : null}
          {typeof event.data.answer === "string" ? (
            <p className="text-muted-foreground">A: {event.data.answer}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
