import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { listApplications } from "@/server/data/applications";
import { requireOnboardedUser } from "@/server/session";
import { ApplicationBoard } from "./board";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage() {
  const user = await requireOnboardedUser();
  const applications = await listApplications(user.id);

  return (
    <div className="mx-auto max-w-[110rem]">
      <PageHeader
        title="Applications"
        description="Drag cards between stages. We remind you to follow up a week after you apply."
        actions={
          <Link href="/applications/new" className={buttonVariants({ variant: "secondary" })}>
            <FileText className="h-4 w-4" aria-hidden /> Tailor to a job description
          </Link>
        }
      />
      <ApplicationBoard
        items={applications.map((item) => ({
          id: item.id,
          companyName: item.companyName,
          jobTitle: item.jobTitle,
          location: item.location,
          status: item.status,
          appliedAt: item.appliedAt?.toISOString() ?? null,
          nextActionAt: item.nextActionAt?.toISOString() ?? null,
          followUpDue: item.followUpDue,
          updatedAt: item.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
