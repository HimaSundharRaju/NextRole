import { getDb, specialistBoard, type BoardColumn } from "@gettargetrole/db";
import { UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ConciergeCard } from "@/components/concierge/board-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { requireRole } from "@/server/session";

export const metadata: Metadata = { title: "Concierge board" };

const COLUMNS: Array<{ id: BoardColumn; label: string }> = [
  { id: "proposed", label: "Proposed" },
  { id: "approved", label: "Approved — to submit" },
  { id: "waiting", label: "Waiting on client" },
  { id: "applied_week", label: "Applied this week" },
  { id: "in_progress", label: "In progress" },
  { id: "closed", label: "Closed" },
];

export default async function ConciergeBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; column?: string }>;
}) {
  const user = await requireRole("specialist", "admin");
  const { client, column } = await searchParams;
  const board = await specialistBoard(getDb(), user.id);
  if (board.clients.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Concierge board"
          description="Your clients' job searches in one place."
        />
        <EmptyState
          icon={UsersRound}
          title="No clients assigned"
          description="An admin assigns Concierge clients from Admin → Concierge."
        />
      </div>
    );
  }
  const cards = board.cards.filter(
    (card) => (!client || card.clientId === client) && (!column || card.column === column),
  );
  const shown = column ? COLUMNS.filter((item) => item.id === column) : COLUMNS;
  const href = (next: { client?: string; column?: string }) => {
    const params = new URLSearchParams();
    if (next.client) params.set("client", next.client);
    if (next.column) params.set("column", next.column);
    const query = params.toString();
    return query ? `/specialist?${query}` : "/specialist";
  };

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Concierge board"
        description="Every client's shortlist, submissions and replies. Every action is logged to the client's timeline."
      />
      <ul className="mb-4 flex gap-3 overflow-x-auto pb-1" aria-label="Clients this week">
        {board.clients.map((week) => (
          <li key={week.clientId}>
            <Link
              href={`/specialist/${week.clientId}`}
              className={cn(
                "block min-w-44 rounded-xl border bg-card p-3 text-sm shadow-sm",
                week.behind ? "border-danger" : "border-border",
              )}
            >
              <p className="font-medium">{week.clientName}</p>
              <p className={cn("text-xs", week.behind ? "text-danger" : "text-muted-foreground")}>
                {week.paused ? "Paused" : `${week.appliedThisWeek} of ${week.target} this week`}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {!week.setupDone ? <Badge tone="warning">Setup unfinished</Badge> : null}
                {week.newAnswers > 0 ? (
                  <Badge tone="primary">
                    {week.newAnswers} new answer{week.newAnswers === 1 ? "" : "s"}
                  </Badge>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <nav className="mb-4 flex flex-wrap gap-2 text-xs" aria-label="Filters">
        <Link
          href={href({ column })}
          className={cn("rounded-full border px-3 py-1", !client && "border-primary text-primary")}
        >
          All clients
        </Link>
        {board.clients.map((week) => (
          <Link
            key={week.clientId}
            href={href({ client: week.clientId, column })}
            className={cn(
              "rounded-full border px-3 py-1",
              client === week.clientId && "border-primary text-primary",
            )}
          >
            {week.clientName}
          </Link>
        ))}
        <span className="mx-1 text-muted-foreground">·</span>
        <Link
          href={href({ client })}
          className={cn("rounded-full border px-3 py-1", !column && "border-primary text-primary")}
        >
          All columns
        </Link>
        {COLUMNS.map((item) => (
          <Link
            key={item.id}
            href={href({ client, column: item.id })}
            className={cn(
              "rounded-full border px-3 py-1",
              column === item.id && "border-primary text-primary",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {shown.map((item) => {
          const inColumn = cards.filter((card) => card.column === item.id);
          return (
            <section
              key={item.id}
              aria-label={`${item.label} column`}
              className="rounded-xl bg-muted/40 p-2"
            >
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                {item.label}
                <span className="text-xs font-normal text-muted-foreground">{inColumn.length}</span>
              </h2>
              <div className="space-y-2">
                {inColumn.map((card) => (
                  <ConciergeCard key={card.id} card={card} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
