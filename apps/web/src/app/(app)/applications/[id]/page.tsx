import type { InterviewPrep } from "@nextrole/ai";
import { ArrowLeft, ExternalLink, FileText, Mail, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { STATUS_META } from "@/lib/statuses";
import { formatDate, timeAgo } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation";
import { getApplicationDetail } from "@/server/data/applications";
import { requireOnboardedUser } from "@/server/session";
import {
  DeleteApplicationButton,
  InterviewPrepCard,
  NotesCard,
  StatusSelect,
} from "./detail-client";

export const metadata: Metadata = { title: "Application" };
export const maxDuration = 300;

const EVENT_LABEL: Record<string, (data: Record<string, unknown>) => string> = {
  created: () => "Added to tracker",
  status_changed: (data) =>
    `Moved to ${STATUS_META[data.to as keyof typeof STATUS_META]?.label ?? String(data.to)}`,
  note: () => "Updated notes",
  kit_generated: (data) =>
    ({
      resume: "Tailored resume created",
      cover_letter: "Cover letter written",
      answers: "Answers drafted",
      interview: "Interview prep generated",
    })[String(data.part)] ?? "Apply kit updated",
  outreach_drafted: () => "Outreach drafted",
  submitted: () => "Submitted — receipt saved",
};

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOnboardedUser();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const detail = await getApplicationDetail(user.id, id).catch(() => null);
  if (!detail) notFound();
  const { application, events, outreach, resume, job } = detail;

  const prepEvent = events.find(
    (event) => event.type === "kit_generated" && event.data.part === "interview",
  );
  const prep = (prepEvent?.data.prep as InterviewPrep | undefined) ?? null;
  const receipt = application.receipt;

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/applications"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Tracker
      </Link>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{application.jobTitle}</h1>
          <p className="mt-1 text-muted-foreground">
            {application.companyName}
            {application.location ? ` · ${application.location}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge tone={STATUS_META[application.status].tone}>
              {STATUS_META[application.status].label}
            </Badge>
            {application.appliedAt ? (
              <Badge tone="outline">Applied {formatDate(application.appliedAt)}</Badge>
            ) : null}
            {job?.closedAt ? <Badge tone="danger">Posting closed</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusSelect applicationId={application.id} status={application.status} />
          {application.jobId ? (
            <Link
              href={`/jobs/${application.jobId}`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Apply kit
            </Link>
          ) : null}
          {application.jobUrl ? (
            <a
              href={application.jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Posting <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
          <DeleteApplicationButton applicationId={application.id} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {receipt ? (
            <Card>
              <CardHeader
                title={
                  <span className="inline-flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-primary" aria-hidden /> What you sent
                  </span>
                }
                description={`Snapshot taken ${formatDate(receipt.submittedAt)}. It won't change if you edit your resume later.`}
              />
              <CardBody className="space-y-3 text-sm">
                <p>
                  <span className="font-medium">Resume: </span>
                  {receipt.resumeTitle || "Not recorded"}
                </p>
                {receipt.coverLetter ? (
                  <details>
                    <summary className="cursor-pointer font-medium">Cover letter</summary>
                    <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                      {receipt.coverLetter}
                    </p>
                  </details>
                ) : null}
                {receipt.answers.length ? (
                  <details>
                    <summary className="cursor-pointer font-medium">
                      Application answers ({receipt.answers.length})
                    </summary>
                    <dl className="mt-2 space-y-2">
                      {receipt.answers.map((item) => (
                        <div key={item.question}>
                          <dt className="font-medium">{item.question}</dt>
                          <dd className="whitespace-pre-wrap text-muted-foreground">
                            {item.answer}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Apply kit"
              description={
                application.jobId ? "Edit or regenerate pieces from the job page." : undefined
              }
            />
            <CardBody className="space-y-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" aria-hidden />
                  {resume ? resume.title : "Using your main resume"}
                </span>
                {resume ? (
                  <Link href={`/resumes/${resume.id}`} className="text-primary">
                    Open
                  </Link>
                ) : null}
              </div>
              {application.coverLetter ? (
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-medium">Cover letter</p>
                    <CopyButton text={application.coverLetter} />
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {application.coverLetter}
                  </p>
                </div>
              ) : null}
              {application.answers.length ? (
                <div>
                  <p className="font-medium">Answers</p>
                  <dl className="mt-1 space-y-2">
                    {application.answers.map((item) => (
                      <div key={item.question}>
                        <dt>{item.question}</dt>
                        <dd className="whitespace-pre-wrap text-muted-foreground">{item.answer}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <InterviewPrepCard applicationId={application.id} initial={prep} />
        </div>

        <div className="space-y-6">
          <NotesCard
            applicationId={application.id}
            notes={application.notes}
            nextActionAt={application.nextActionAt?.toISOString() ?? null}
          />

          {outreach.length ? (
            <Card>
              <CardHeader
                title="Outreach"
                action={
                  <Link href="/outreach" className="text-sm text-primary">
                    All
                  </Link>
                }
              />
              <CardBody className="space-y-3 text-sm">
                {outreach.map((message) => (
                  <div key={message.id} className="flex items-start gap-2">
                    <Mail className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{message.subject || "LinkedIn note"}</p>
                      <p className="text-xs text-muted-foreground">
                        {message.status === "sent" ? `Sent ${formatDate(message.sentAt)}` : "Draft"}
                      </p>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Timeline" />
            <CardBody>
              <ol className="space-y-3 border-l border-border pl-4 text-sm">
                {events.map((event) => (
                  <li key={event.id} className="relative">
                    <span
                      className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-primary"
                      aria-hidden
                    />
                    <p>{(EVENT_LABEL[event.type] ?? (() => event.type))(event.data)}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(event.createdAt)}</p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
