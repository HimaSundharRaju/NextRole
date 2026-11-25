import { SUPPORT_TOPICS, type CaseQueue } from "@gettargetrole/db";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { requireCareAgent } from "@/server/care";
import { CompaniesTab } from "./tabs/companies";
import { ReportsTab } from "./tabs/reports";
import { RequestsTab } from "./tabs/requests";
import { UsersTab } from "./tabs/users";

export const metadata: Metadata = { title: "Customer care" };

const TABS = [
  { id: "requests", label: "Requests" },
  { id: "reports", label: "Reports" },
  { id: "companies", label: "Company requests" },
  { id: "users", label: "Users" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const QUEUE_IDS: CaseQueue[] = ["open", "mine", "unassigned", "overdue", "waiting", "solved"];

export default async function CarePage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    queue?: string;
    topic?: string;
    q?: string;
    hidden?: string;
  }>;
}) {
  const agent = await requireCareAgent();
  const params = await searchParams;
  const tab: Tab = TABS.find((item) => item.id === params.tab)?.id ?? "requests";
  const queue = QUEUE_IDS.find((id) => id === params.queue) ?? "open";
  const topic = SUPPORT_TOPICS.find((value) => value === params.topic);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Customer care"
        description="Help requests, account problems and escalations, in one place. Every action is logged."
      />
      <nav className="mb-4 flex gap-2 border-b border-border" aria-label="Care tabs">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/care?tab=${item.id}`}
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
      {tab === "requests" ? (
        <RequestsTab
          agentId={agent.id}
          queue={queue}
          topic={topic}
          search={params.q?.trim() || undefined}
        />
      ) : null}
      {tab === "reports" ? <ReportsTab showHidden={params.hidden === "1"} /> : null}
      {tab === "companies" ? <CompaniesTab /> : null}
      {tab === "users" ? <UsersTab query={params.q?.trim() || undefined} /> : null}
    </div>
  );
}
