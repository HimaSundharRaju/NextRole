import type { ConciergeContext } from "@gettargetrole/db";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { timeAgo } from "@/lib/utils";

/** A Concierge client's week, for customer care: who looks after them and how it's going. */
export function ConciergePanel({
  context,
  isAdmin,
}: {
  context: ConciergeContext;
  isAdmin: boolean;
}) {
  return (
    <Card>
      <CardHeader title="Concierge" />
      <CardBody className="space-y-1.5 text-sm">
        <p>
          <span className="text-muted-foreground">Specialist: </span>
          {context.specialistName
            ? `${context.specialistName} (${context.specialistEmail})`
            : "None assigned"}
        </p>
        <p className="flex items-center gap-2">
          <span className="text-muted-foreground">Setup: </span>
          <Badge tone={context.setupDone ? "success" : "warning"}>
            {context.setupDone ? "Done" : "Unfinished"}
          </Badge>
        </p>
        <p>
          <span className="text-muted-foreground">This week: </span>
          {context.thisWeek.applied} of {context.thisWeek.target}
        </p>
        <p>
          <span className="text-muted-foreground">Last week: </span>
          {context.lastWeek.applied} of {context.lastWeek.target}
        </p>
        <p>
          <span className="text-muted-foreground">Proposals waiting: </span>
          {context.openProposals}
        </p>
        <p>
          <span className="text-muted-foreground">Last activity: </span>
          {context.lastActivity ? timeAgo(context.lastActivity) : "—"}
        </p>
        {isAdmin ? (
          <Link href="/admin?tab=specialists" className="inline-block font-medium text-primary">
            Change specialist in Admin → Concierge
          </Link>
        ) : null}
      </CardBody>
    </Card>
  );
}
