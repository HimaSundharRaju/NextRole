"use client";

import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { requestCompany } from "@/app/(app)/jobs/company-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import type { CompanyRequestRow } from "@/server/data/jobs";

const STATUS: Record<
  CompanyRequestRow["status"],
  { label: string; tone: "neutral" | "success" | "primary" | "warning" }
> = {
  pending: { label: "Looking", tone: "neutral" },
  added: { label: "Added", tone: "success" },
  tracked: { label: "Already here", tone: "primary" },
  not_found: { label: "No board found", tone: "warning" },
};

/** "Missing a company?": asks for one by name or careers link, and shows past requests. */
export function CompanyRequest({ requests }: { requests: CompanyRequestRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const query = String(new FormData(formElement).get("query") ?? "");
    startTransition(async () => {
      const result = await requestCompany({ query });
      if (!result.ok) {
        setError(result.fieldErrors?.query ?? result.error);
        return;
      }
      setError(null);
      formElement.reset();
      toast.success("Thanks — we're looking for its job board now.");
      router.refresh();
    });
  }

  return (
    <section
      className="mt-8 rounded-xl border border-border bg-card p-5"
      aria-labelledby="company-request-title"
    >
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="company-request-title" className="font-semibold">
            Missing a company?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tell us which one, by name or with a link to its careers page. We look for its job board
            and add its roles, usually within minutes.
          </p>
          <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              name="query"
              required
              minLength={2}
              maxLength={300}
              placeholder="e.g. Barclays or https://careers.example.com"
              aria-label="Company name or careers link"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "company-request-error" : undefined}
            />
            <Button type="submit" loading={pending} className="shrink-0">
              Request
            </Button>
          </form>
          {error ? (
            <p id="company-request-error" className="mt-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {requests.length > 0 ? (
            <ul className="mt-4 space-y-2 text-sm">
              {requests.map((request) => {
                const status = STATUS[request.status];
                return (
                  <li key={request.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate font-medium">
                      {request.companyName ?? (request.name || request.url)}
                    </span>
                    <Badge tone={status.tone}>{status.label}</Badge>
                    {request.status === "added" && request.note ? (
                      <span className="text-muted-foreground">{request.note}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
