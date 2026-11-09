import {
  accountSummary,
  caseThread,
  firstReplyState,
  getDb,
  otherCases,
  users,
} from "@gettargetrole/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import {
  dueLabel,
  STAFF_STATUS_LABEL,
  STATUS_TONE,
  SUPPORT_TOPIC_LABEL,
} from "@/lib/support-labels";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { careAgents, requireCareAgent } from "@/server/care";
import {
  CaseReplyBox,
  HandOffForm,
  ReopenButton,
  SolveButton,
  TakeButton,
} from "../../case-client";

export const metadata: Metadata = { title: "Request" };

const SOURCE_LABEL = {
  form: "Contact support form",
  specialist: "Raised by a specialist",
  weekly_check: "Monday missed-target check",
} as const;

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const agent = await requireCareAgent();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const thread = await caseThread(db, id, { includeInternal: true });
  if (!thread) notFound();
  const request = thread.case;
  const now = new Date();
  const [requester, others, agents, [owner]] = await Promise.all([
    request.userId ? accountSummary(db, request.userId) : null,
    otherCases(db, { caseId: id, userId: request.userId, contactEmail: request.contactEmail }),
    careAgents(),
    request.assigneeId
      ? db.select({ name: users.name }).from(users).where(eq(users.id, request.assigneeId)).limit(1)
      : Promise.resolve([]),
  ]);
  const due = firstReplyState(request, now);
  const canHandOff = agent.role === "admin" || request.assigneeId === agent.id;
  const handOffTo = agents.filter((item) => item.id !== request.assigneeId);

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/care" className="text-sm text-muted-foreground hover:text-foreground">
        ← Customer care
      </Link>
      <PageHeader
        title={`#${request.number} ${request.subject}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {SUPPORT_TOPIC_LABEL[request.topic]}
            {request.kind === "escalation" ? <Badge tone="warning">Escalation</Badge> : null}
            <span>· {SOURCE_LABEL[request.source]}</span>
            <span>· opened {timeAgo(request.createdAt)}</span>
          </span>
        }
        actions={
          <Badge tone={STATUS_TONE[request.status]}>{STAFF_STATUS_LABEL[request.status]}</Badge>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <p>
          <span className="text-muted-foreground">Owner: </span>
          {owner?.name ?? "Unassigned"}
        </p>
        {due ? (
          <p className={due.overdue ? "font-medium text-danger" : undefined}>
            {dueLabel(due, now)}
          </p>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {request.assigneeId ? null : <TakeButton caseId={id} />}
          {canHandOff && handOffTo.length > 0 ? (
            <HandOffForm caseId={id} agents={handOffTo} />
          ) : null}
          {request.status === "solved" ? <ReopenButton caseId={id} /> : <SolveButton caseId={id} />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <ol className="space-y-3">
            {thread.messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "rounded-xl border p-4 text-sm",
                  message.visibility === "internal"
                    ? "border-warning/40 bg-warning-soft/40"
                    : message.authorKind === "agent"
                      ? "border-primary/30 bg-primary-soft/40"
                      : "border-border bg-card",
                )}
              >
                <p className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
                  {message.visibility === "internal" ? (
                    <Badge tone="warning">Internal note</Badge>
                  ) : null}
                  <span>
                    {message.authorName ??
                      (message.authorKind === "system"
                        ? "System"
                        : message.authorKind === "user"
                          ? request.contactName || "Requester"
                          : "Support")}{" "}
                    · {timeAgo(message.createdAt)}
                  </span>
                </p>
                <p className="whitespace-pre-wrap">{message.body}</p>
              </li>
            ))}
          </ol>
          <Card>
            <CardBody>
              <CaseReplyBox caseId={id} solved={request.status === "solved"} />
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader title="Requester" />
            <CardBody className="space-y-1.5 text-sm">
              <p className="font-medium">{request.contactName || requester?.name || "Unknown"}</p>
              <p className="break-all text-muted-foreground">{request.contactEmail}</p>
              <p className="text-muted-foreground">
                {request.verifiedAt
                  ? "Confirmed they made this request."
                  : "Hasn't confirmed this request."}
              </p>
              {requester ? (
                <>
                  <p className="capitalize">
                    <span className="normal-case text-muted-foreground">Plan: </span>
                    {requester.plan}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Joined: </span>
                    {formatDate(requester.createdAt)}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Email verified: </span>
                    {requester.emailVerified ? "Yes" : "No"}
                  </p>
                  <Link
                    href={`/care/users/${requester.id}?case=${id}`}
                    className="inline-block font-medium text-primary"
                  >
                    Open their account →
                  </Link>
                </>
              ) : (
                <p className="text-muted-foreground">No account</p>
              )}
            </CardBody>
          </Card>
          {others.length > 0 ? (
            <Card>
              <CardHeader title="Other requests" />
              <CardBody className="space-y-2 text-sm">
                {others.map((item) => (
                  <Link
                    key={item.id}
                    href={`/care/cases/${item.id}`}
                    className="block hover:underline"
                  >
                    <span className="font-medium">
                      #{item.number} {item.subject}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {STAFF_STATUS_LABEL[item.status]} · {timeAgo(item.createdAt)}
                    </span>
                  </Link>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
