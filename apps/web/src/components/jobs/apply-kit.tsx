"use client";

import {
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  FileText,
  Mail,
  MessageSquareText,
  PenLine,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  answerApplicationQuestions,
  draftOutreach,
  markApplied,
  saveJob,
  saveKit,
  tailorResumeForJob,
  writeCoverLetter,
} from "@/app/(app)/jobs/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { AllowanceNote } from "@/components/usage/usage-bars";
import type { UnitAllowance } from "@/lib/plans";
import { cn, formatDate } from "@/lib/utils";

/** Jobs below this match ask before spending a tailored resume (MIN_AI_MATCH in the plans). */
const LOW_MATCH = 70;

interface KitApplication {
  id: string;
  status: string;
  resumeId: string | null;
  coverLetter: string;
  answers: Array<{ question: string; answer: string }>;
  appliedAt: string | null;
}

interface TailorNotes {
  summaryOfChanges: string[];
  missingKeywords: string[];
  suggestions: string[];
}

/** What the kit is for: a job on the board, or an application with a pasted job description. */
export type KitTarget = { jobId: string } | { applicationId: string };

export type KitAllowances = Record<"tailor" | "letter" | "answers" | "outreach", UnitAllowance>;

/** The tailored resume's saved notes, and whether it was made from an older main resume. */
interface KitTailored {
  notes: TailorNotes | null;
  stale: boolean;
}

function Step({
  done,
  icon: Icon,
  title,
  children,
}: {
  done: boolean;
  icon: typeof FileText;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-5 py-4 last:border-b-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
        <Icon className="h-4 w-4 text-primary" aria-hidden />
        {title}
      </h3>
      <div className="mt-3 space-y-3 text-sm">{children}</div>
    </section>
  );
}

export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function ApplyKit({
  target,
  applyUrl,
  application,
  tailored,
  allowances,
  matchScore,
}: {
  target: KitTarget;
  /** The employer's application page; empty when unknown. */
  applyUrl: string;
  application: KitApplication | null;
  tailored: KitTailored | null;
  allowances: KitAllowances;
  /** How well the job matches the main resume; null for pasted job descriptions. */
  matchScore: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [tailorNotes, setTailorNotes] = useState<TailorNotes | null>(tailored?.notes ?? null);
  const [tailorStale, setTailorStale] = useState(tailored?.stale ?? false);
  const [coverLetter, setCoverLetter] = useState(application?.coverLetter ?? "");
  const [answers, setAnswers] = useState(application?.answers ?? []);
  const [questions, setQuestions] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmLowMatch, setConfirmLowMatch] = useState(false);
  const [outreach, setOutreach] = useState<{
    email: { subject: string; body: string };
    linkedinNote: string;
    recipientEmail: string;
  } | null>(null);

  function run<T>(
    key: string,
    task: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    onSuccess: (data: T) => void,
  ) {
    setBusy(key);
    setError(null);
    startTransition(async () => {
      const result = await task();
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      onSuccess(result.data);
      router.refresh();
    });
  }

  const applied = Boolean(application?.appliedAt);
  const ready = !applied && application?.status === "ready";

  function tailor(force: boolean) {
    setConfirmLowMatch(false);
    run(
      "tailor",
      () => tailorResumeForJob({ ...target, force }),
      (data) => {
        setTailorNotes(data);
        setTailorStale(false);
        toast.success(
          data.reused ? "Opened your tailored resume for this role." : "Tailored resume ready.",
        );
      },
    );
  }

  return (
    <Card>
      <CardHeader
        title="Apply kit"
        description="The AI prepares everything; you review and submit."
        action={
          applied ? (
            <Badge tone="success">Applied</Badge>
          ) : ready ? (
            <Badge tone="primary">Ready to apply</Badge>
          ) : null
        }
      />
      {ready ? (
        <p className="border-b border-border bg-muted/50 px-5 py-3 text-sm">
          Auto-prepare made your tailored resume and cover letter. Review them, then submit on the
          company&apos;s site.
        </p>
      ) : null}
      <div>
        <Step done={Boolean(application?.resumeId)} icon={FileText} title="Tailored resume">
          {application?.resumeId ? (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/resumes/${application.resumeId}`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                <PenLine className="h-3.5 w-3.5" aria-hidden /> Review in Studio
              </Link>
              <a
                href={`/api/resumes/${application.resumeId}/export?format=pdf`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                <Download className="h-3.5 w-3.5" aria-hidden /> PDF
              </a>
              <a
                href={`/api/resumes/${application.resumeId}/export?format=docx`}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                <Download className="h-3.5 w-3.5" aria-hidden /> Word
              </a>
            </div>
          ) : (
            <p className="text-muted-foreground">
              A copy of your main resume, rewritten for this role. Your original stays untouched.
            </p>
          )}
          {tailorStale ? (
            <p className="text-xs text-warning">
              Made from an earlier version of your main resume. Tailor again to pick up your
              changes.
            </p>
          ) : null}
          {tailorNotes ? (
            <div className="rounded-lg bg-muted p-3 text-xs">
              <p className="font-medium">What changed</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {tailorNotes.summaryOfChanges.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {tailorNotes.missingKeywords.length ? (
                <p className="mt-2">
                  <span className="font-medium">Not on your resume: </span>
                  {tailorNotes.missingKeywords.join(", ")} — add them only if you truly have them.
                </p>
              ) : null}
              {tailorNotes.suggestions.length ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {tailorNotes.suggestions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {confirmLowMatch && matchScore !== null ? (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs">
              <p>
                This job is a {matchScore}% match. Tailoring rarely turns a weak match into an
                interview. Use 1 of your {allowances.tailor.left} tailored resumes anyway?
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => tailor(Boolean(application?.resumeId))}>
                  Tailor anyway
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmLowMatch(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant={application?.resumeId ? "ghost" : "primary"}
              loading={busy === "tailor"}
              disabled={busy !== null || allowances.tailor.left === 0}
              onClick={() =>
                matchScore !== null && matchScore < LOW_MATCH
                  ? setConfirmLowMatch(true)
                  : tailor(Boolean(application?.resumeId))
              }
            >
              {busy === "tailor"
                ? "Tailoring… (about 30s)"
                : application?.resumeId
                  ? "Tailor again"
                  : "Tailor my resume"}
            </Button>
          )}
          <AllowanceNote allowance={allowances.tailor} />
        </Step>

        <Step done={Boolean(coverLetter)} icon={PenLine} title="Cover letter">
          {coverLetter ? (
            <>
              <Textarea
                value={coverLetter}
                onChange={(event) => {
                  setCoverLetter(event.target.value);
                  setDirty(true);
                }}
                rows={10}
                aria-label="Cover letter"
              />
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={coverLetter} />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              A short, specific letter connecting your best results to this role.
            </p>
          )}
          <Button
            size="sm"
            variant={coverLetter ? "ghost" : "primary"}
            loading={busy === "letter"}
            disabled={busy !== null || allowances.letter.left === 0}
            onClick={() =>
              run(
                "letter",
                () => writeCoverLetter({ ...target }),
                (data) => {
                  setCoverLetter(data.body);
                  setDirty(false);
                  toast.success("Cover letter written.");
                },
              )
            }
          >
            {coverLetter ? "Rewrite" : "Write cover letter"}
          </Button>
          <AllowanceNote allowance={allowances.letter} />
        </Step>

        <Step done={answers.length > 0} icon={MessageSquareText} title="Application questions">
          <Textarea
            value={questions}
            onChange={(event) => setQuestions(event.target.value)}
            rows={3}
            placeholder={
              "Paste the form's questions, one per line.\ne.g. Why do you want to work here?"
            }
            aria-label="Application questions"
          />
          <Button
            size="sm"
            variant="secondary"
            loading={busy === "answers"}
            disabled={busy !== null || !questions.trim() || allowances.answers.left === 0}
            onClick={() =>
              run(
                "answers",
                () =>
                  answerApplicationQuestions({
                    ...target,
                    questions: questions
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  }),
                (data) => {
                  setAnswers((current) => {
                    const merged = new Map(current.map((item) => [item.question, item.answer]));
                    data.forEach((item) => merged.set(item.question, item.answer));
                    return [...merged.entries()].map(([question, answer]) => ({
                      question,
                      answer,
                    }));
                  });
                  setQuestions("");
                  toast.success("Answers drafted in your voice.");
                },
              )
            }
          >
            Answer with AI
          </Button>
          <AllowanceNote allowance={allowances.answers} />
          {answers.map((item, index) => (
            <div key={item.question} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{item.question}</p>
                <CopyButton text={item.answer} />
              </div>
              <Textarea
                className="mt-2"
                value={item.answer}
                rows={3}
                aria-label={`Answer to: ${item.question}`}
                onChange={(event) => {
                  const next = [...answers];
                  next[index] = { ...item, answer: event.target.value };
                  setAnswers(next);
                  setDirty(true);
                }}
              />
              {item.answer.includes("[Please fill in") ? (
                <p className="mt-1 text-xs text-warning">Needs your input before you submit.</p>
              ) : null}
            </div>
          ))}
          {dirty && application ? (
            <Button
              size="sm"
              loading={busy === "save"}
              onClick={() =>
                run(
                  "save",
                  () => saveKit({ applicationId: application.id, coverLetter, answers }),
                  () => {
                    setDirty(false);
                    toast.success("Changes saved.");
                  },
                )
              }
            >
              Save edits
            </Button>
          ) : null}
        </Step>

        <Step done={Boolean(outreach)} icon={Mail} title="Reach the hiring team">
          <form
            className="grid gap-2 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const recipientEmail = String(form.get("recipientEmail") ?? "");
              run(
                "outreach",
                () =>
                  draftOutreach({
                    ...target,
                    recipientName: String(form.get("recipientName") ?? "") || undefined,
                    recipientTitle: String(form.get("recipientTitle") ?? "") || undefined,
                    recipientEmail,
                  }),
                (data) => {
                  setOutreach({
                    email: data.email,
                    linkedinNote: data.linkedinNote,
                    recipientEmail,
                  });
                  toast.success("Outreach drafted.");
                },
              );
            }}
          >
            <Input name="recipientName" placeholder="Name (optional)" aria-label="Recipient name" />
            <Input
              name="recipientTitle"
              placeholder="Title (optional)"
              aria-label="Recipient title"
            />
            <Input
              name="recipientEmail"
              type="email"
              placeholder="Email (optional)"
              aria-label="Recipient email"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              loading={busy === "outreach"}
              disabled={busy !== null || allowances.outreach.left === 0}
              className="sm:col-span-3 sm:w-fit"
            >
              Draft email & LinkedIn note
            </Button>
          </form>
          <AllowanceNote allowance={allowances.outreach} />
          {outreach ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Email · {outreach.email.subject}
                </p>
                <p className="mt-2 whitespace-pre-wrap">{outreach.email.body}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <CopyButton text={`${outreach.email.subject}\n\n${outreach.email.body}`} />
                  <a
                    href={gmailComposeUrl(
                      outreach.recipientEmail,
                      outreach.email.subject,
                      outreach.email.body,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden /> Open in Gmail
                  </a>
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">LinkedIn note</p>
                <p className="mt-2">{outreach.linkedinNote}</p>
                <CopyButton text={outreach.linkedinNote} className="mt-2" />
              </div>
              <Link href="/outreach" className="text-xs font-medium text-primary">
                All drafts, including a follow-up →
              </Link>
            </div>
          ) : null}
        </Step>

        <section className="px-5 py-4">
          {error ? (
            <div className="mb-3">
              <Alert>{error}</Alert>
            </div>
          ) : null}
          <div className={cn("flex flex-wrap gap-2", applied && "items-center")}>
            {applyUrl ? (
              <a
                href={applyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "secondary" })}
              >
                Open application <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            ) : null}
            {applied ? (
              <span className="text-sm text-success">
                Applied on {formatDate(application!.appliedAt)} — receipt saved.
              </span>
            ) : (
              <Button
                loading={busy === "applied"}
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "applied",
                    async () => {
                      let applicationId = application?.id;
                      if (!applicationId && "jobId" in target) {
                        const saved = await saveJob({ jobId: target.jobId });
                        if (!saved.ok) return saved;
                        applicationId = saved.data.applicationId;
                      }
                      if (!applicationId)
                        return { ok: false as const, error: "Save the job first." };
                      return markApplied({ applicationId });
                    },
                    () =>
                      toast.success("Marked as applied. We'll remind you to follow up in a week."),
                  )
                }
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden /> I&apos;ve applied
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            You submit on the company&apos;s site, so nothing is sent without your review.
          </p>
        </section>
      </div>
    </Card>
  );
}
