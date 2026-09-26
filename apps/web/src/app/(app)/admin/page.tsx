import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";
import { PLANS } from "@/lib/plans";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import {
  aiUsageReport,
  listAssignments,
  listCompanies,
  platformStats,
  recentAuditLogs,
  searchUsers,
} from "@/server/data/admin";
import { requireRole } from "@/server/session";
import {
  AddCompanyForm,
  AssignForm,
  CompanyActions,
  UnassignButton,
  UserControls,
} from "./admin-client";

export const metadata: Metadata = { title: "Admin" };

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "ai", label: "AI usage" },
  { id: "companies", label: "Job sources" },
  { id: "users", label: "Users" },
  { id: "specialists", label: "Concierge" },
  { id: "audit", label: "Audit log" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireRole("admin");
  const params = await searchParams;
  const tab: Tab = TABS.some((item) => item.id === params.tab) ? (params.tab as Tab) : "overview";
  const query = typeof params.q === "string" ? params.q.slice(0, 100) : undefined;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Admin"
        description="Operate job ingestion, users, concierge assignments and security."
      />
      <nav
        className="mb-6 flex gap-1 overflow-x-auto border-b border-border"
        aria-label="Admin sections"
      >
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/admin?tab=${item.id}`}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
              tab === item.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            aria-current={tab === item.id ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? <Overview /> : null}
      {tab === "ai" ? <AiUsage /> : null}
      {tab === "companies" ? <Companies /> : null}
      {tab === "users" ? <Users query={query} adminId={admin.id} /> : null}
      {tab === "specialists" ? <Specialists /> : null}
      {tab === "audit" ? <Audit /> : null}
    </div>
  );
}

async function Overview() {
  const stats = await platformStats();
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <Stat label="Users" value={stats.users} />
      <Stat
        label="Open jobs"
        value={stats.openJobs.toLocaleString()}
        hint={`${stats.newJobs24h.toLocaleString()} found in the last 24h`}
      />
      <Stat label="Active job sources" value={stats.activeCompanies} />
      <Stat label="Applications this week" value={stats.applicationsThisWeek} />
      <Stat
        label="AI spend this month"
        value={`$${stats.aiSpendUsdThisMonth.toFixed(2)}`}
        hint="Estimated from token usage"
      />
    </div>
  );
}

const FEATURE_LABEL: Record<string, string> = {
  import: "Resume import",
  generate: "Resume from scratch",
  tailor: "Tailored resume",
  match: "Fit analysis",
  cover_letter: "Cover letter",
  answers: "Application answers",
  outreach: "Outreach",
  interview: "Interview prep",
  studio: "Studio",
};

const VENDOR_LABEL = { anthropic: "Anthropic", openai: "OpenAI" } as const;

function money(value: number): string {
  if (value >= 100) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

/** Per-call costs run to fractions of a cent. */
function smallMoney(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function tokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

async function AiUsage() {
  const report = await aiUsageReport();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="AI spend this month"
          value={money(report.spendUsd)}
          hint={`${report.calls.toLocaleString()} calls`}
        />
        <Stat
          label="Share of plan revenue"
          value={report.planRevenueUsd > 0 ? percent(report.spendUsd / report.planRevenueUsd) : "—"}
          hint={`${money(report.planRevenueUsd)} a month at list prices`}
        />
        <Stat
          label="Input read from cache"
          value={percent(report.cacheReadShare)}
          hint="Billed at a tenth of the input price or less"
        />
        <Stat
          label="Saved with batches"
          value={money(report.batchSavingsUsd)}
          hint={`${percent(report.batchShare)} of spend at half price · ${report.waitingInBatches} waiting`}
        />
      </div>

      <Card>
        <CardHeader
          title="By feature"
          description="What each kind of AI work costs this month, per call and in total."
        />
        <CardBody className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Feature</th>
                <th className="py-2 pr-3 text-right">Calls</th>
                <th className="py-2 pr-3 text-right">Per call</th>
                <th className="py-2 pr-3 text-right">Batched</th>
                <th className="py-2 text-right">Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.byFeature.map((row) => (
                <tr key={row.feature}>
                  <td className="py-2 pr-3 font-medium">
                    {FEATURE_LABEL[row.feature] ?? row.feature}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.calls.toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {smallMoney(row.perCallUsd)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {row.batchCalls > 0 ? percent(row.batchCalls / row.calls) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(row.spendUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.byFeature.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No AI calls yet this month.</p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="By model"
          description="Which models the routes send work to. Input includes cached tokens."
        />
        <CardBody className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 pr-3 text-right">Calls</th>
                <th className="py-2 pr-3 text-right">Input</th>
                <th className="py-2 pr-3 text-right">From cache</th>
                <th className="py-2 pr-3 text-right">Output</th>
                <th className="py-2 text-right">Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.byModel.map((row) => (
                <tr key={row.model}>
                  <td className="py-2 pr-3">
                    <p className="font-medium">{row.model}</p>
                    <p className="text-xs text-muted-foreground">{VENDOR_LABEL[row.vendor]}</p>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.calls.toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{tokens(row.inputTokens)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                    {row.inputTokens > 0 ? percent(row.cacheReadTokens / row.inputTokens) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{tokens(row.outputTokens)}</td>
                  <td className="py-2 text-right tabular-nums">{money(row.spendUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Top spenders"
          description="Spend against each user's plan cap. At the cap, AI features pause until next month."
        />
        <CardBody className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Plan</th>
                <th className="py-2 pr-3 text-right">Spend</th>
                <th className="py-2 text-right">Of cap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.topSpenders.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-3">
                    <p className="font-medium">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{PLANS[row.plan].name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(row.spendUsd)}</td>
                  <td className="py-2 text-right">
                    <Badge
                      tone={
                        row.capShare >= 1 ? "danger" : row.capShare >= 0.8 ? "warning" : "neutral"
                      }
                    >
                      {percent(row.capShare)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

async function Companies() {
  const rows = await listCompanies();
  return (
    <Card>
      <CardHeader
        title="Job sources"
        description="Public career boards polled by the worker. New boards sync within a minute."
      />
      <CardBody className="space-y-4">
        <AddCompanyForm />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Company</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3">Open jobs</th>
                <th className="py-2 pr-3">Last sync</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((company) => (
                <tr key={company.id} className={company.active ? undefined : "opacity-60"}>
                  <td className="py-2 pr-3 font-medium">{company.name}</td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    <span className="capitalize">{company.ats}</span> · {company.boardToken}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{company.openJobCount}</td>
                  <td className="py-2 pr-3">
                    {company.lastSyncStatus === "error" ? (
                      <Badge tone="danger" title={company.lastSyncError ?? undefined}>
                        Failed {timeAgo(company.lastSyncedAt)}
                      </Badge>
                    ) : company.lastSyncedAt ? (
                      <span className="text-muted-foreground">{timeAgo(company.lastSyncedAt)}</span>
                    ) : (
                      <span className="text-muted-foreground">Pending</span>
                    )}
                  </td>
                  <td className="py-2">
                    <CompanyActions companyId={company.id} active={company.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

async function Users({ query, adminId }: { query?: string; adminId: string }) {
  const rows = await searchUsers(query);
  return (
    <Card>
      <CardHeader
        title="Users"
        description="Change roles and plans, or ban abusive accounts. Every change is audited."
      />
      <CardBody className="space-y-4">
        <form className="flex gap-2" action="/admin">
          <input type="hidden" name="tab" value="users" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by name or email"
            className="h-9 w-full max-w-sm rounded-lg border border-input bg-card px-3 text-sm"
            aria-label="Search users"
          />
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Joined</th>
                <th className="py-2 text-right">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-3">
                    <p className="font-medium">
                      {row.name} {row.banned ? <Badge tone="danger">Banned</Badge> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{row.email}</p>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{formatDate(row.createdAt)}</td>
                  <td className="py-2">
                    <UserControls
                      userId={row.id}
                      role={row.role}
                      plan={row.plan}
                      banned={Boolean(row.banned)}
                      isSelf={row.id === adminId}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

async function Specialists() {
  const { specialists, assignments } = await listAssignments();
  const byId = new Map(specialists.map((specialist) => [specialist.id, specialist]));
  return (
    <Card>
      <CardHeader
        title="Concierge assignments"
        description="Specialists can view and update their clients' application pipelines."
      />
      <CardBody className="space-y-4">
        <AssignForm specialists={specialists} />
        <ul className="divide-y divide-border text-sm">
          {assignments.map((assignment) => (
            <li
              key={`${assignment.specialistId}-${assignment.clientId}`}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span>
                <span className="font-medium">{assignment.clientName}</span>{" "}
                <span className="text-muted-foreground">({assignment.clientEmail})</span> →{" "}
                {byId.get(assignment.specialistId)?.name ?? "Unknown specialist"}
              </span>
              <UnassignButton
                specialistId={assignment.specialistId}
                clientId={assignment.clientId}
              />
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

async function Audit() {
  const rows = await recentAuditLogs(100);
  return (
    <Card>
      <CardHeader title="Audit log" description="Security-relevant events, newest first." />
      <CardBody className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Actor</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">Target</th>
              <th className="py-2">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                  {timeAgo(row.createdAt)}
                </td>
                <td className="py-2 pr-3">{row.actorEmail ?? "system"}</td>
                <td className="py-2 pr-3 font-mono text-xs">{row.action}</td>
                <td className="py-2 pr-3 text-xs text-muted-foreground">
                  {row.targetType}
                  {row.targetId ? ` · ${row.targetId.slice(0, 8)}` : ""}
                </td>
                <td className="py-2 font-mono text-xs text-muted-foreground">
                  {row.ipAddress || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
