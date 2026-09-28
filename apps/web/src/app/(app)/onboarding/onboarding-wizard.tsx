"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { PreferencesForm, type PreferencesValues } from "@/components/profile/preferences-form";
import { ResumeImport, type ImportedResume } from "@/components/resume/resume-import";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function OnboardingWizard({
  firstName,
  hasResume,
  preferences,
}: {
  firstName: string;
  hasResume: boolean;
  preferences: PreferencesValues;
}) {
  const [step, setStep] = useState<1 | 2>(hasResume ? 2 : 1);
  const [imported, setImported] = useState<ImportedResume | null>(null);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">
        Welcome{firstName ? `, ${firstName}` : ""} 👋
      </h1>
      <p className="mt-1 text-muted-foreground">
        Two quick steps and GetTargetRole will start matching jobs for you.
      </p>

      <ol className="mt-6 flex gap-3 text-sm" aria-label="Setup progress">
        {["Your resume", "What you're looking for"].map((label, index) => {
          const number = (index + 1) as 1 | 2;
          const done = number < step || (number === 1 && (hasResume || imported));
          return (
            <li
              key={label}
              className={cn(
                "flex flex-1 items-center gap-2 rounded-lg border px-3 py-2",
                step === number
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted-foreground",
              )}
              aria-current={step === number ? "step" : undefined}
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
              ) : (
                <span className="font-semibold">{number}.</span>
              )}
              {label}
            </li>
          );
        })}
      </ol>

      <Card className="mt-6">
        <CardBody className="p-6">
          {step === 1 ? (
            imported ? (
              <div>
                <p className="flex items-center gap-2 font-medium text-success">
                  <CheckCircle2 className="h-5 w-5" aria-hidden /> Your resume is ready
                </p>
                {imported.name ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {imported.name}
                    {imported.headline ? ` — ${imported.headline}` : ""}
                  </p>
                ) : null}
                {imported.notes?.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {imported.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
                <Button className="mt-5" onClick={() => setStep(2)}>
                  Continue
                </Button>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold">Add your resume</h2>
                <p className="mb-5 mt-1 text-sm text-muted-foreground">
                  The AI reads it exactly as written. You can polish it in the Resume Studio later.
                </p>
                <ResumeImport makePrimary onDone={setImported} />
              </>
            )
          ) : (
            <>
              <h2 className="text-lg font-semibold">What are you looking for?</h2>
              <p className="mb-5 mt-1 text-sm text-muted-foreground">
                We use this to rank jobs and to answer application questions accurately. You can
                change it anytime.
              </p>
              <PreferencesForm
                initial={preferences}
                completeOnboarding
                submitLabel="Finish setup"
              />
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
