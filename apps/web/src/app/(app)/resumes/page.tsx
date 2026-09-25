import { FileText, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { timeAgo } from "@/lib/utils";
import { listResumes } from "@/server/data/resumes";
import { requireOnboardedUser } from "@/server/session";
import { NewResumeButtons, ResumeRowMenu } from "./resume-list-actions";

export const metadata: Metadata = { title: "Resumes" };
export const maxDuration = 180;

export default async function ResumesPage() {
  const user = await requireOnboardedUser();
  const resumes = await listResumes(user.id);
  const masters = resumes.filter((resume) => resume.kind === "master");
  const tailored = resumes.filter((resume) => resume.kind === "tailored");

  const renderGroup = (title: string, items: typeof resumes, description: string) => (
    <section className="mt-8 first:mt-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((resume) => (
          <article
            key={resume.id}
            className="relative rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <FileText className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-medium">
                    <Link href={`/resumes/${resume.id}`} className="after:absolute after:inset-0">
                      {resume.title}
                    </Link>
                  </h3>
                  <p className="truncate text-xs text-muted-foreground">
                    {resume.headline || "No headline yet"}
                  </p>
                </div>
              </div>
              <ResumeRowMenu resumeId={resume.id} isPrimary={resume.isPrimary} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              {resume.isPrimary ? (
                <Badge tone="primary">
                  <Star className="h-3 w-3" aria-hidden /> Main
                </Badge>
              ) : null}
              <Badge tone="outline" className="capitalize">
                {resume.settings.template}
              </Badge>
              <span>Edited {timeAgo(resume.updatedAt)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Resumes"
        description="Your main resume powers job matching. Tailored copies are created for specific jobs."
        actions={<NewResumeButtons />}
      />
      {resumes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No resumes yet"
          description="Import your current resume or start a new one with Claude."
        />
      ) : (
        <>
          {masters.length
            ? renderGroup("Your resumes", masters, "General versions you can tailor from.")
            : null}
          {tailored.length
            ? renderGroup("Tailored for jobs", tailored, "Created from a job's apply kit.")
            : null}
        </>
      )}
    </div>
  );
}
