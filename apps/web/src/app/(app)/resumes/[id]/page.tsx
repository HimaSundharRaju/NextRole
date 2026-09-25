import { companies, getDb, jobs } from "@nextrole/db";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { uuidSchema } from "@/lib/validation";
import { getResume, listMessages, listRevisions, type ResumeRow } from "@/server/data/resumes";
import { requireOnboardedUser } from "@/server/session";
import { ResumeStudio } from "./studio";

export const metadata: Metadata = { title: "Resume Studio" };
export const maxDuration = 300;

async function linkedJob(jobId: string | null) {
  if (!jobId) return null;
  const [row] = await getDb()
    .select({
      id: jobs.id,
      title: jobs.title,
      description: jobs.descriptionText,
      company: companies.name,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  return row ?? null;
}

export default async function ResumeStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOnboardedUser();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  let resume: ResumeRow;
  try {
    resume = await getResume(user.id, id);
  } catch {
    notFound();
  }
  const [messages, revisions, job] = await Promise.all([
    listMessages(user.id, resume.id),
    listRevisions(user.id, resume.id),
    linkedJob(resume.jobId),
  ]);

  return (
    <ResumeStudio
      key={resume.id}
      resumeId={resume.id}
      title={resume.title}
      kind={resume.kind}
      isPrimary={resume.isPrimary}
      initialResume={resume.content}
      initialSettings={resume.settings}
      job={job}
      messages={messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
      }))}
      revisions={revisions.map((revision) => ({
        id: revision.id,
        source: revision.source,
        note: revision.note,
        createdAt: revision.createdAt.toISOString(),
      }))}
    />
  );
}
