import type { BoardCard } from "@gettargetrole/db";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

/** One application on the specialist's board. */
export function ConciergeCard({ card }: { card: BoardCard }) {
  const kit = [
    card.hasResume ? "Resume" : null,
    card.hasLetter ? "Letter" : null,
    card.answerCount > 0 ? `${card.answerCount} answers` : null,
  ].filter(Boolean);
  return (
    <Link
      href={`/specialist/${card.clientId}/applications/${card.id}`}
      className="block rounded-lg border border-border bg-card p-3 text-sm shadow-sm hover:shadow-md"
    >
      <p className="font-medium leading-snug">{card.jobTitle}</p>
      <p className="text-xs text-muted-foreground">
        {card.companyName} · {card.clientName}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone="outline">{timeAgo(card.updatedAt)}</Badge>
        {card.needsAccount ? <Badge tone="warning">Needs an employer account</Badge> : null}
        {card.postingClosed ? <Badge tone="danger">Posting closed</Badge> : null}
        {kit.length > 0 ? <Badge tone="success">{kit.join(" · ")}</Badge> : null}
      </div>
    </Link>
  );
}
