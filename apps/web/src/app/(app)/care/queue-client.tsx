"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import {
  addRequestedCompany,
  declineRequestedCompany,
  hideJobAction,
  keepJobAction,
  unhideJobAction,
} from "./actions";
import { useCareAction } from "./use-care-action";

/** Keep a reported job (it's real), or hide it (with a reason). */
export function ReportActions({ jobId }: { jobId: string }) {
  const { pending, run } = useCareAction();
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="secondary"
        loading={pending}
        onClick={() =>
          run(() => keepJobAction({ jobId }), "Kept. Its reports no longer add ghost points.")
        }
      >
        Keep it
      </Button>
      <div className="flex flex-wrap gap-2">
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          placeholder="Why hide it?"
          aria-label="Why hide this job"
          className="h-9 min-w-56 flex-1"
        />
        <Button
          size="sm"
          variant="danger"
          disabled={!reason.trim()}
          loading={pending}
          onClick={() =>
            run(
              () => hideJobAction({ jobId, reason }),
              "Hidden from search.",
              () => setReason(""),
            )
          }
        >
          Hide it
        </Button>
      </div>
    </div>
  );
}

export function ShowAgainButton({ jobId }: { jobId: string }) {
  const { pending, run } = useCareAction();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() => run(() => unhideJobAction({ jobId }), "Back in search.")}
    >
      Show it again
    </Button>
  );
}

/** Add a requested company from its careers link, or say why it can't be added. */
export function CompanyRequestActions({
  requestId,
  name,
  url,
}: {
  requestId: string;
  name: string;
  url: string;
}) {
  const { pending, run } = useCareAction();
  const [careersUrl, setCareersUrl] = useState(url);
  const [companyName, setCompanyName] = useState(name);
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Input
          value={careersUrl}
          onChange={(event) => setCareersUrl(event.target.value)}
          placeholder="https://… careers page or job board"
          aria-label="Careers link"
          className="h-9 min-w-64 flex-1"
        />
        <Input
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          maxLength={120}
          placeholder="Company name"
          aria-label="Company name"
          className="h-9 w-48"
        />
        <Button
          size="sm"
          disabled={!careersUrl.trim()}
          loading={pending}
          onClick={() =>
            run(
              () => addRequestedCompany({ requestId, url: careersUrl.trim(), name: companyName }),
              "Added. Its jobs will show up shortly, and the people who asked are told.",
            )
          }
        >
          Add it
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          placeholder="Why can't we add it? (the person is told)"
          aria-label="Why we can't add it"
          className="h-9 min-w-64 flex-1"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!reason.trim()}
          loading={pending}
          onClick={() =>
            run(
              () => declineRequestedCompany({ requestId, reason }),
              "Declined, and the person is told.",
              () => setReason(""),
            )
          }
        >
          Can&apos;t add it
        </Button>
      </div>
    </div>
  );
}
