"use client";

import type { InterviewPrep } from "@gettargetrole/ai";
import type { ApplicationStatus } from "@gettargetrole/db/schema";
import { GraduationCap, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { prepareInterview } from "@/app/(app)/jobs/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { AllowanceNote } from "@/components/usage/usage-bars";
import type { UnitAllowance } from "@/lib/plans";
import { STATUS_META } from "@/lib/statuses";
import { moveApplication, removeApplication, updateApplicationDetails } from "../actions";

export function StatusSelect({
  applicationId,
  status,
}: {
  applicationId: string;
  status: ApplicationStatus;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(status);
  const [pending, startTransition] = useTransition();
  return (
    <Select
      value={value}
      disabled={pending}
      className="h-9 w-40"
      aria-label="Application status"
      onChange={(event) => {
        const next = event.target.value as ApplicationStatus;
        setValue(next);
        startTransition(async () => {
          const result = await moveApplication({ applicationId, status: next });
          if (!result.ok) {
            toast.error(result.error);
            setValue(status);
            return;
          }
          toast.success(`Moved to ${STATUS_META[next].label}.`);
          router.refresh();
        });
      }}
    >
      {Object.entries(STATUS_META).map(([key, meta]) => (
        <option key={key} value={key}>
          {meta.label}
        </option>
      ))}
    </Select>
  );
}

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

export function NotesCard({
  applicationId,
  notes,
  nextActionAt,
}: {
  applicationId: string;
  notes: string;
  nextActionAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("nextActionAt") ?? "");
    startTransition(async () => {
      const result = await updateApplicationDetails({
        applicationId,
        notes: String(form.get("notes") ?? ""),
        nextActionAt: date ? new Date(`${date}T09:00:00`).toISOString() : null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title="Notes & follow-up" />
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Follow-up date" htmlFor="nextActionAt" hint="We'll remind you on this day.">
            <Input
              id="nextActionAt"
              name="nextActionAt"
              type="date"
              defaultValue={toDateInput(nextActionAt)}
            />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              rows={6}
              defaultValue={notes}
              placeholder="Recruiter name, interview dates, salary discussed…"
            />
          </Field>
          <Button type="submit" size="sm" loading={pending}>
            Save
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function InterviewPrepCard({
  applicationId,
  initial,
  allowance,
}: {
  applicationId: string;
  initial: InterviewPrep | null;
  allowance: UnitAllowance;
}) {
  const [prep, setPrep] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Interview prep"
        description="Likely questions with answer outlines from your real experience."
        action={
          <Button
            size="sm"
            variant={prep ? "secondary" : "primary"}
            loading={pending}
            disabled={allowance.left === 0}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await prepareInterview({ applicationId });
                if (!result.ok) setError(result.error);
                else setPrep(result.data);
              })
            }
          >
            <GraduationCap className="h-4 w-4" aria-hidden /> {prep ? "Regenerate" : "Prepare me"}
          </Button>
        }
      />
      <CardBody className="space-y-4 text-sm">
        {error ? <Alert>{error}</Alert> : null}
        <AllowanceNote allowance={allowance} />
        {prep ? (
          <>
            <ol className="space-y-4">
              {prep.questions.map((item, index) => (
                <li key={index} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{item.question}</p>
                    <Badge tone="outline" className="capitalize">
                      {item.category}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.whyTheyAsk}</p>
                  <p className="mt-2 whitespace-pre-wrap">{item.answerOutline}</p>
                </li>
              ))}
            </ol>
            {prep.questionsToAsk.length ? (
              <div>
                <p className="font-medium">Questions to ask them</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {prep.questionsToAsk.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">
            Generate a prep sheet once you land a screen or interview.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export function DeleteApplicationButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-danger"
      loading={pending}
      onClick={() => {
        if (!window.confirm("Remove this application from your tracker?")) return;
        startTransition(async () => {
          const result = await removeApplication({ applicationId });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          router.replace("/applications");
          router.refresh();
        });
      }}
    >
      <Trash2 className="h-4 w-4" aria-hidden /> Remove
    </Button>
  );
}
