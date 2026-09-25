"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { savePreferences } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { splitList } from "@/lib/validation";

export interface PreferencesValues {
  targetTitles: string[];
  targetLocations: string[];
  remotePreference: "remote" | "hybrid" | "onsite" | "any";
  seniority: string | null;
  minSalary: number | null;
  salaryCurrency: string;
  workAuthorization: string;
  needsSponsorship: boolean;
  alertsEnabled: boolean;
  alertMinScore: number;
}

const SENIORITY_OPTIONS = [
  ["", "Not specified"],
  ["intern", "Intern"],
  ["entry", "Entry level"],
  ["mid", "Mid level"],
  ["senior", "Senior"],
  ["staff", "Staff"],
  ["principal", "Principal"],
  ["manager", "Manager"],
  ["director", "Director"],
  ["executive", "Executive"],
] as const;

export function PreferencesForm({
  initial,
  completeOnboarding = false,
  submitLabel = "Save preferences",
}: {
  initial: PreferencesValues;
  completeOnboarding?: boolean;
  submitLabel?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const salary = String(form.get("minSalary") ?? "").replace(/[^\d]/g, "");
    const seniority = String(form.get("seniority") ?? "");
    startTransition(async () => {
      const result = await savePreferences({
        targetTitles: splitList(String(form.get("targetTitles") ?? "")),
        targetLocations: splitList(String(form.get("targetLocations") ?? "")),
        remotePreference: form.get("remotePreference") as PreferencesValues["remotePreference"],
        seniority: (seniority || null) as never,
        minSalary: salary ? Number(salary) : null,
        salaryCurrency: String(form.get("salaryCurrency") ?? "USD"),
        workAuthorization: String(form.get("workAuthorization") ?? ""),
        needsSponsorship: form.get("needsSponsorship") === "on",
        alertsEnabled: form.get("alertsEnabled") === "on",
        alertMinScore: Number(form.get("alertMinScore") ?? 70),
        completeOnboarding,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      setErrors({});
      setFormError(null);
      if (completeOnboarding) {
        router.replace("/dashboard");
        router.refresh();
      } else {
        toast.success("Preferences saved.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Target roles"
          htmlFor="targetTitles"
          hint="Separate with commas, e.g. Backend Engineer, Platform Engineer"
          error={errors.targetTitles}
        >
          <Input
            id="targetTitles"
            name="targetTitles"
            defaultValue={initial.targetTitles.join(", ")}
          />
        </Field>
        <Field
          label="Preferred locations"
          htmlFor="targetLocations"
          hint="Cities or regions, comma separated"
          error={errors.targetLocations}
        >
          <Input
            id="targetLocations"
            name="targetLocations"
            defaultValue={initial.targetLocations.join(", ")}
          />
        </Field>
        <Field label="Work style" htmlFor="remotePreference">
          <Select
            id="remotePreference"
            name="remotePreference"
            defaultValue={initial.remotePreference}
          >
            <option value="any">Open to anything</option>
            <option value="remote">Remote only</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">On-site</option>
          </Select>
        </Field>
        <Field label="Seniority" htmlFor="seniority">
          <Select id="seniority" name="seniority" defaultValue={initial.seniority ?? ""}>
            {SENIORITY_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="Minimum base salary" htmlFor="minSalary" error={errors.minSalary}>
            <Input
              id="minSalary"
              name="minSalary"
              inputMode="numeric"
              placeholder="e.g. 150000"
              defaultValue={initial.minSalary ?? ""}
            />
          </Field>
          <Field label="Currency" htmlFor="salaryCurrency">
            <Select id="salaryCurrency" name="salaryCurrency" defaultValue={initial.salaryCurrency}>
              {["USD", "EUR", "GBP", "CAD", "INR", "AUD"].map((code) => (
                <option key={code}>{code}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Work authorization"
          htmlFor="workAuthorization"
          hint="Used only to answer application questions, e.g. “US citizen” or “H-1B”"
          error={errors.workAuthorization}
        >
          <Input
            id="workAuthorization"
            name="workAuthorization"
            defaultValue={initial.workAuthorization}
          />
        </Field>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-4">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="needsSponsorship"
            defaultChecked={initial.needsSponsorship}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          I will need visa sponsorship
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="alertsEnabled"
            defaultChecked={initial.alertsEnabled}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          Alert me when a new job matches my profile
        </label>
        <div className="flex items-center gap-3 text-sm">
          <label htmlFor="alertMinScore" className="text-muted-foreground">
            Alert threshold
          </label>
          <Select
            id="alertMinScore"
            name="alertMinScore"
            defaultValue={String(initial.alertMinScore)}
            className="h-9 w-32"
          >
            {[50, 60, 70, 80, 90].map((score) => (
              <option key={score} value={score}>
                {score}%+ match
              </option>
            ))}
          </Select>
        </div>
      </div>

      {formError ? <Alert>{formError}</Alert> : null}
      <Button type="submit" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
