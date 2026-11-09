import { companyRequestQueue, getDb } from "@gettargetrole/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { timeAgo } from "@/lib/utils";
import { CompanyRequestActions } from "../queue-client";

/** Companies people asked for that discovery couldn't find a job board for. */
export async function CompaniesTab() {
  const requests = await companyRequestQueue(getDb());
  if (requests.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
        No company requests need an answer.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {requests.map((request) => (
        <li key={request.id}>
          <Card>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{request.name || request.url}</p>
                  {request.name && request.url ? (
                    <p className="break-all text-xs text-muted-foreground">{request.url}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Asked by {request.requesterEmail ?? "someone who has left"} ·{" "}
                    {timeAgo(request.createdAt)}
                  </p>
                </div>
                <Badge tone={request.status === "not_found" ? "warning" : "neutral"}>
                  {request.status === "not_found" ? "No board found" : "Still looking"}
                </Badge>
              </div>
              {request.note ? (
                <p className="text-sm text-muted-foreground">{request.note}</p>
              ) : null}
              <CompanyRequestActions requestId={request.id} name={request.name} url={request.url} />
            </CardBody>
          </Card>
        </li>
      ))}
    </ul>
  );
}
