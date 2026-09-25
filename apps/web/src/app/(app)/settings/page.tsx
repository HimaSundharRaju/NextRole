import { Download } from "lucide-react";
import type { Metadata } from "next";
import { PreferencesForm } from "@/components/profile/preferences-form";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, ProgressBar } from "@/components/ui/misc";
import { PLANS } from "@/lib/plans";
import { monthlyAiSpendMicroUsd } from "@/server/ai";
import { getProfile } from "@/server/data/profile";
import { requireOnboardedUser } from "@/server/session";
import { AboutForm, DangerZone, PasswordForm } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireOnboardedUser();
  const [profile, spend] = await Promise.all([
    getProfile(user.id),
    monthlyAiSpendMicroUsd(user.id),
  ]);
  const plan = PLANS[user.plan];
  const used = Math.min(100, Math.round((spend / (plan.monthlyAiBudgetUsd * 1_000_000)) * 100));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Settings" description="Your preferences, profile, account and data." />

      <Card>
        <CardHeader
          title="Job preferences"
          description="Used to rank jobs, send alerts and answer application questions."
        />
        <CardBody>
          <PreferencesForm
            initial={{
              targetTitles: profile.targetTitles,
              targetLocations: profile.targetLocations,
              remotePreference: profile.remotePreference,
              seniority: profile.seniority,
              minSalary: profile.minSalary,
              salaryCurrency: profile.salaryCurrency,
              workAuthorization: profile.workAuthorization,
              needsSponsorship: profile.needsSponsorship,
              alertsEnabled: profile.alertsEnabled,
              alertMinScore: profile.alertMinScore,
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="About you"
          description="Context the AI uses to write in your voice. Never shared with employers unless you send it."
        />
        <CardBody>
          <AboutForm
            initial={{
              headline: profile.headline,
              phone: profile.phone,
              linkedinUrl: profile.linkedinUrl,
              githubUrl: profile.githubUrl,
              portfolioUrl: profile.portfolioUrl,
              voiceNotes: profile.voiceNotes,
            }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Plan & usage" />
        <CardBody className="space-y-3 text-sm">
          <p>
            You&apos;re on the <span className="font-semibold">{plan.name}</span> plan.
          </p>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>AI credits this month</span>
              <span>{used}% used</span>
            </div>
            <ProgressBar value={used} className="mt-1" />
          </div>
          <p className="text-muted-foreground">
            Need more? Contact support to upgrade — self-serve billing is coming soon.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Account" description={`Signed in as ${user.email}`} />
        <CardBody>
          <PasswordForm />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Your data"
          description="Export everything we store about you, or delete it."
        />
        <CardBody className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-medium">Download my data</p>
              <p className="text-muted-foreground">
                A JSON file with your profile, resumes, applications and history.
              </p>
            </div>
            <a href="/api/account/export" className={buttonVariants({ variant: "secondary" })}>
              <Download className="h-4 w-4" aria-hidden /> Export
            </a>
          </div>
          <DangerZone />
        </CardBody>
      </Card>
    </div>
  );
}
