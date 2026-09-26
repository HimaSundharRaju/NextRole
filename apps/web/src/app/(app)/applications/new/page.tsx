import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { JobDescriptionForm } from "@/components/applications/job-description-form";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { PLAN_LIMITS } from "@gettargetrole/db/plans";
import { requireOnboardedUser } from "@/server/session";

export const metadata: Metadata = { title: "Tailor to a job description" };

export default async function NewFromJobDescriptionPage() {
  const user = await requireOnboardedUser();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/applications"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Tracker
      </Link>
      <div className="mt-4">
        <PageHeader
          title="Tailor to a job description"
          description="Found a job on LinkedIn, Indeed or anywhere else? Paste its description to get a tailored resume, a cover letter and an outreach email."
        />
      </div>
      {PLAN_LIMITS[user.plan].tailor === 0 ? (
        <div className="mb-4">
          <Alert tone="warning">
            Tailored resumes and cover letters come with Plus. You can still save the job to your
            tracker. <Link href="/settings#plan">Compare plans</Link>
          </Alert>
        </div>
      ) : null}
      <Card>
        <CardBody className="p-6">
          <JobDescriptionForm />
        </CardBody>
      </Card>
    </div>
  );
}
