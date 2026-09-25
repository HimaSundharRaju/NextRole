import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile, hasPrimaryResume } from "@/server/data/profile";
import { requireUser } from "@/server/session";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata: Metadata = { title: "Get started" };
export const maxDuration = 180;

export default async function OnboardingPage() {
  const user = await requireUser();
  if (user.onboardedAt) redirect("/dashboard");
  const [profile, hasResume] = await Promise.all([getProfile(user.id), hasPrimaryResume(user.id)]);

  return (
    <OnboardingWizard
      firstName={user.name.split(" ")[0] ?? ""}
      hasResume={hasResume}
      preferences={{
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
  );
}
