import {
  accountActivity,
  accountSummary,
  deletableForCase,
  getDb,
  type AccountSummary,
} from "@gettargetrole/db";
import { USAGE_UNITS } from "@gettargetrole/db/plans";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { UsageBars } from "@/components/usage/usage-bars";
import { canActOnAccount } from "@/lib/care-rules";
import { allowancesFor, PLANS } from "@/lib/plans";
import { formatDate, timeAgo } from "@/lib/utils";
import { monthlyAiSpendMicroUsd, monthlyUsage } from "@/server/ai";
import { recordAudit } from "@/server/audit";
import { requireCareAgent } from "@/server/care";
import { AccountActions } from "../../account-client";

export const metadata: Metadata = { title: "Account" };

const statusCounts = (byStatus: AccountSummary["applicationsByStatus"]) =>
  Object.entries(byStatus)
    .map(([status, count]) => `${count} ${status.replace(/_/g, " ")}`)
    .join(" · ") || "None";

export default async function CareAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ case?: string }>;
}) {
  const agent = await requireCareAgent();
  const { id } = await params;
  const { case: caseParam } = await searchParams;
  const caseId = z.uuid().safeParse(caseParam).success ? caseParam : undefined;
  const db = getDb();
  const account = await accountSummary(db, id);
  if (!account) notFound();
  await recordAudit({
    actorUserId: agent.id,
    action: "care.user.view",
    targetType: "user",
    targetId: id,
  });
  const [usage, spend, activity, deletable] = await Promise.all([
    monthlyUsage(id),
    monthlyAiSpendMicroUsd(id),
    accountActivity(db, id),
    caseId ? deletableForCase(db, { userId: id, caseId }) : false,
  ]);
  const allowances = allowancesFor(account.plan, usage);
  const budget = PLANS[account.plan].monthlyAiBudgetUsd;
  const canAct = canActOnAccount(agent, account);

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href={caseId ? `/care/cases/${caseId}` : "/care?tab=users"}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        {caseId ? "← Back to the request" : "← Users"}
      </Link>
      <PageHeader
        title={account.name}
        description={account.email}
        actions={
          <span className="flex items-center gap-2">
            {account.banned ? <Badge tone="danger">Banned</Badge> : null}
            <Badge tone="outline" className="capitalize">
              {account.role}
            </Badge>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Account" />
            <CardBody className="space-y-1.5 text-sm">
              <p className="capitalize">
                <span className="normal-case text-muted-foreground">Plan: </span>
                {account.plan}
              </p>
              <p>
                <span className="text-muted-foreground">Email verified: </span>
                {account.emailVerified ? "Yes" : "No"}
              </p>
              <p>
                <span className="text-muted-foreground">Joined: </span>
                {formatDate(account.createdAt)}
              </p>
              <p>
                <span className="text-muted-foreground">Last sign-in: </span>
                {account.lastSignInAt ? timeAgo(account.lastSignInAt) : "Never"}
              </p>
              {account.banned ? (
                <p className="text-danger">Banned: {account.banReason ?? "no reason recorded"}</p>
              ) : null}
              <p>
                <span className="text-muted-foreground">Applications: </span>
                {statusCounts(account.applicationsByStatus)}
              </p>
              <p>
                <span className="text-muted-foreground">Resumes: </span>
                {account.resumes}
              </p>
              <p>
                <span className="text-muted-foreground">Requests: </span>
                {account.openCases} open · {account.solvedCases} solved{" "}
                <Link
                  href={`/care?tab=requests&q=${encodeURIComponent(account.email)}`}
                  className="font-medium text-primary"
                >
                  See them
                </Link>
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="This month"
              description={`AI spend $${(spend / 1_000_000).toFixed(2)} of $${budget}`}
            />
            <CardBody>
              <UsageBars allowances={allowances} units={USAGE_UNITS} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent activity" description="The last 20 audit entries." />
            <CardBody>
              {activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {activity.map((entry, index) => (
                    <li key={index} className="flex items-baseline justify-between gap-3">
                      <span>
                        <span className="font-mono text-xs">{entry.action}</span>
                        {entry.actorEmail && entry.actorEmail !== account.email ? (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            by {entry.actorEmail}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader
              title="Actions"
              description="Each one needs a reason, and goes in the audit log."
            />
            <CardBody>
              {canAct ? (
                <AccountActions
                  userId={id}
                  caseId={caseId}
                  email={account.email}
                  emailVerified={account.emailVerified}
                  banned={account.banned}
                  plan={account.plan}
                  deletable={deletable}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {agent.id === id
                    ? "You can't change your own account here."
                    : "Staff accounts are managed by admins."}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
