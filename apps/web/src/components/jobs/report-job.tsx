"use client";

import type { JobReportReason } from "@gettargetrole/db/schema";
import { Flag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { reportJob, withdrawReport } from "@/app/(app)/jobs/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { JOB_REPORT_REASON_LABEL } from "@/lib/job-labels";

const REASONS = Object.keys(JOB_REPORT_REASON_LABEL) as JobReportReason[];

/** Lets a job seeker say a job isn't really open; reports from several people hide it. */
export function ReportJob({
  jobId,
  reported,
}: {
  jobId: string;
  reported: JobReportReason | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "") as JobReportReason;
    const note = String(form.get("note") ?? "");
    startTransition(async () => {
      const result = await reportJob({ jobId, reason, note: note || undefined });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success("Thanks. Reports from several people hide a job for everyone.");
      router.refresh();
    });
  }

  function withdraw() {
    startTransition(async () => {
      const result = await withdrawReport({ jobId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (reported) {
    return (
      <p className="text-xs text-muted-foreground">
        You reported this job: {JOB_REPORT_REASON_LABEL[reported].toLowerCase()}.{" "}
        <button
          type="button"
          onClick={withdraw}
          disabled={pending}
          className="font-medium text-primary hover:underline disabled:opacity-50"
        >
          Undo
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <Flag className="h-3.5 w-3.5" aria-hidden /> Not really open? Report this job
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-medium">What&apos;s wrong with this job?</legend>
        {REASONS.map((reason, index) => (
          <label key={reason} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="reason"
              value={reason}
              required
              defaultChecked={index === 0}
              className="accent-primary"
            />
            {JOB_REPORT_REASON_LABEL[reason]}
          </label>
        ))}
      </fieldset>
      <Textarea
        name="note"
        maxLength={500}
        rows={2}
        placeholder="Anything to add? (optional)"
        aria-label="Anything to add"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Report
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
