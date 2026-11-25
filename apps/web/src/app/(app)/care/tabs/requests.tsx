import { careCounts, getDb, listCases, type CaseQueue } from "@gettargetrole/db";
import type { SupportTopic } from "@gettargetrole/db/schema";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Stat } from "@/components/ui/misc";
import {
  dueLabel,
  STAFF_STATUS_LABEL,
  STATUS_TONE,
  SUPPORT_TOPIC_LABEL,
  typicalReplyLabel,
} from "@/lib/support-labels";
import { cn, timeAgo } from "@/lib/utils";

const QUEUES: Array<{ id: CaseQueue; label: string }> = [
  { id: "open", label: "All open" },
  { id: "mine", label: "Mine" },
  { id: "unassigned", label: "Unassigned" },
  { id: "overdue", label: "Overdue" },
  { id: "waiting", label: "Waiting on user" },
  { id: "solved", label: "Solved" },
];

/** Cases for one queue, with the numbers that say where the team stands. */
export async function RequestsTab({
  agentId,
  queue,
  topic,
  search,
}: {
  agentId: string;
  queue: CaseQueue;
  topic?: SupportTopic;
  search?: string;
}) {
  const db = getDb();
  const now = new Date();
  const [counts, cases] = await Promise.all([
    careCounts(db, now),
    listCases(db, { queue, agentId, topic, search, now }),
  ]);
  const href = (next: { queue?: CaseQueue }) => {
    const params = new URLSearchParams({ tab: "requests" });
    if (next.queue && next.queue !== "open") params.set("queue", next.queue);
    if (topic) params.set("topic", topic);
    if (search) params.set("q", search);
    return `/care?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Unassigned" value={counts.unassigned} />
        <Stat label="Overdue" value={counts.overdue} hint="No reply 24 hours after opening" />
        <Stat label="Waiting on user" value={counts.waiting} />
        <Stat
          label="Typical first reply"
          value={typicalReplyLabel(counts.typicalFirstReplyMinutes)}
          hint="Help requests, last 7 days"
        />
      </div>

      <nav className="flex flex-wrap gap-2 text-xs" aria-label="Queues">
        {QUEUES.map((item) => (
          <Link
            key={item.id}
            href={href({ queue: item.id })}
            className={cn(
              "rounded-full border px-3 py-1",
              queue === item.id ? "border-primary text-primary" : "border-border",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <form className="flex flex-wrap gap-2" action="/care">
        <input type="hidden" name="tab" value="requests" />
        {queue !== "open" ? <input type="hidden" name="queue" value={queue} /> : null}
        <Select name="topic" defaultValue={topic ?? ""} aria-label="Topic" className="h-9 w-48">
          <option value="">All topics</option>
          {(Object.keys(SUPPORT_TOPIC_LABEL) as SupportTopic[]).map((value) => (
            <option key={value} value={value}>
              {SUPPORT_TOPIC_LABEL[value]}
            </option>
          ))}
        </Select>
        <Input
          name="q"
          defaultValue={search ?? ""}
          placeholder="Number, email or subject"
          aria-label="Search requests"
          className="h-9 w-64"
        />
        <Button type="submit" size="sm" variant="secondary">
          Filter
        </Button>
      </form>

      {cases.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Request</th>
                <th className="px-4 py-2">Requester</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2">Last message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cases.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2">
                    <Link href={`/care/cases/${row.id}`} className="font-medium hover:underline">
                      #{row.number} {row.subject}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {SUPPORT_TOPIC_LABEL[row.topic]}
                      {row.kind === "escalation" ? <Badge tone="warning">Escalation</Badge> : null}
                    </p>
                  </td>
                  <td className="px-4 py-2">
                    <p>{row.requesterName || "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.requesterEmail}
                      {row.requesterPlan ? ` · ${row.requesterPlan}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-2">
                    {row.assigneeName ?? <span className="text-muted-foreground">Unassigned</span>}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[row.status]}>{STAFF_STATUS_LABEL[row.status]}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    {row.due ? (
                      <span className={row.due.overdue ? "font-medium text-danger" : undefined}>
                        {dueLabel(row.due, now)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Opened {timeAgo(row.createdAt)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {row.lastMessageAt ? timeAgo(row.lastMessageAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
