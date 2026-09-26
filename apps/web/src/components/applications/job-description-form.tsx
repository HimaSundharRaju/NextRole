"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createFromJobDescription, saveJobDescription } from "@/app/(app)/applications/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";

/**
 * Paste a job description to tailor a resume for a job that isn't on the board. Without an
 * `applicationId` it starts a new application; with one, it adds the description to it.
 */
export function JobDescriptionForm({ applicationId }: { applicationId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    startTransition(async () => {
      const result = applicationId
        ? await saveJobDescription({ applicationId, jobDescription: text("jobDescription") })
        : await createFromJobDescription({
            companyName: text("companyName"),
            jobTitle: text("jobTitle"),
            jobUrl: text("jobUrl"),
            location: text("location"),
            jobDescription: text("jobDescription"),
          });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      setErrors({});
      setFormError(null);
      if (result.data) {
        router.push(`/applications/${result.data.id}`);
      } else {
        toast.success("Job description saved.");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {applicationId ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company" htmlFor="companyName" error={errors.companyName}>
            <Input id="companyName" name="companyName" required maxLength={120} />
          </Field>
          <Field label="Job title" htmlFor="jobTitle" error={errors.jobTitle}>
            <Input id="jobTitle" name="jobTitle" required maxLength={160} />
          </Field>
          <Field label="Job link (optional)" htmlFor="jobUrl" error={errors.jobUrl}>
            <Input id="jobUrl" name="jobUrl" type="url" placeholder="https://…" />
          </Field>
          <Field label="Location (optional)" htmlFor="location" error={errors.location}>
            <Input id="location" name="location" maxLength={120} />
          </Field>
        </div>
      )}
      <Field
        label="Job description"
        htmlFor="jobDescription"
        hint="Paste the whole posting: responsibilities, requirements and any pay or visa details."
        error={errors.jobDescription}
      >
        <Textarea
          id="jobDescription"
          name="jobDescription"
          required
          rows={applicationId ? 8 : 14}
          maxLength={20_000}
        />
      </Field>
      {formError ? <Alert>{formError}</Alert> : null}
      <Button type="submit" loading={pending}>
        {applicationId ? "Save job description" : "Continue to the apply kit"}
      </Button>
    </form>
  );
}
