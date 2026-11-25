import { getDb, userCases } from "@gettargetrole/db";
import { LifeBuoy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { STATUS_TONE, USER_STATUS_LABEL } from "@/lib/support-labels";
import { timeAgo } from "@/lib/utils";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Your requests" };

export default async function RequestsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=%2Fsupport%2Frequests");
  const requests = await userCases(getDb(), user.id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Your requests"
        description="What you've asked us, and what we said."
        actions={
          <Link href="/support" className={buttonVariants()}>
            New request
          </Link>
        }
      />
      {requests.length === 0 ? (
        <Card>
          <EmptyState
            icon={LifeBuoy}
            title="No requests yet"
            description="When you contact support, you can follow it here."
          />
        </Card>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {requests.map((request) => (
            <li key={request.id}>
              <Link
                href={`/support/requests/${request.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    #{request.number} {request.subject}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {timeAgo(request.lastMessageAt)}
                  </span>
                </span>
                <Badge tone={STATUS_TONE[request.status]}>
                  {USER_STATUS_LABEL[request.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
