import { canUserSeeCase, caseThread, getDb, linkStatus, openToRequester } from "@gettargetrole/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { STATUS_TONE, SUPPORT_TOPIC_LABEL, USER_STATUS_LABEL } from "@/lib/support-labels";
import { cn, timeAgo } from "@/lib/utils";
import { getCurrentUser } from "@/server/session";
import { ConfirmButton, ReplyBox } from "./thread-client";

export const metadata: Metadata = { title: "Request" };

/**
 * A request's public thread. You get here from your requests (signed in), or from the private
 * link in an email, which works signed out and shows only what staff said to you.
 */
export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const { id } = await params;
  const { key } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const user = await getCurrentUser();
  const link = key ? await linkStatus(db, key) : null;
  const viaKey = link?.caseId === id;
  const viaSession = user ? await canUserSeeCase(db, { caseId: id, userId: user.id }) : false;
  if (!viaKey && !viaSession) notFound();

  // An old email link says so, and shows nothing of the request.
  if (viaKey && !viaSession && link!.expired) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="This link has expired" />
        <Card>
          <CardBody className="space-y-3 text-sm">
            <p>This request was solved more than 14 days ago, so its link no longer works.</p>
            <Link href="/support" className={buttonVariants()}>
              Start a new request
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  const thread = await caseThread(db, id, { includeInternal: false });
  if (!thread) notFound();
  const request = thread.case;
  const closed = !openToRequester(request.status, request.solvedAt, new Date());
  // Someone who typed our customer's email into the form hasn't proven it's theirs.
  const needsConfirming = viaKey && Boolean(request.userId) && !request.verifiedAt;

  return (
    <div className="mx-auto max-w-2xl">
      {viaSession ? (
        <Link
          href="/support/requests"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Your requests
        </Link>
      ) : null}
      <PageHeader
        title={`#${request.number} ${request.subject}`}
        description={SUPPORT_TOPIC_LABEL[request.topic]}
        actions={
          <Badge tone={STATUS_TONE[request.status]}>{USER_STATUS_LABEL[request.status]}</Badge>
        }
      />
      {needsConfirming ? (
        <Card className="mb-4">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>Did you send this request?</p>
            <ConfirmButton caseId={id} accessKey={key!} />
          </CardBody>
        </Card>
      ) : null}
      <ol className="space-y-3">
        {thread.messages.map((message) => (
          <li
            key={message.id}
            className={cn(
              "rounded-xl border p-4 text-sm",
              message.authorKind === "user"
                ? "border-border bg-card"
                : "border-primary/30 bg-primary-soft/40",
            )}
          >
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {message.authorKind === "user" ? "You" : "Support team"} ·{" "}
              {timeAgo(message.createdAt)}
            </p>
            <p className="whitespace-pre-wrap">{message.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6">
        {closed ? (
          <Card>
            <CardBody className="space-y-3 text-sm">
              <Alert tone="warning">This request is closed.</Alert>
              <Link href={`/support?followUp=${request.number}`} className={buttonVariants()}>
                Start a new request
              </Link>
            </CardBody>
          </Card>
        ) : (
          <ReplyBox caseId={id} accessKey={viaSession ? undefined : key} />
        )}
      </div>
    </div>
  );
}
