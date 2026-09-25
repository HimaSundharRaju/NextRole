"use client";

import { ClipboardPaste, FileUp, Sparkles, UploadCloud } from "lucide-react";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { generateResume } from "@/app/(app)/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

type Mode = "upload" | "paste" | "scratch";

export interface ImportedResume {
  id: string;
  name?: string;
  headline?: string;
  notes?: string[];
}

async function postImport(body: FormData): Promise<ImportedResume> {
  const response = await fetch("/api/resumes/import", { method: "POST", body });
  const data = (await response.json().catch(() => ({}))) as ImportedResume & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Import failed. Please try again.");
  return data;
}

export function ResumeImport({
  makePrimary,
  onDone,
}: {
  makePrimary: boolean;
  onDone: (resume: ImportedResume) => void;
}) {
  const [mode, setMode] = useState<Mode>("upload");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function run(task: () => Promise<ImportedResume>) {
    setError(null);
    startTransition(async () => {
      try {
        onDone(await task());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a PDF or Word file first.");
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("makePrimary", String(makePrimary));
    run(() => postImport(body));
  }

  function onPaste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    body.set("makePrimary", String(makePrimary));
    run(() => postImport(body));
  }

  function onScratch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run(async () => {
      const result = await generateResume({
        targetRole: String(form.get("targetRole") ?? ""),
        background: String(form.get("background") ?? ""),
      });
      if (!result.ok)
        throw new Error(result.fieldErrors ? Object.values(result.fieldErrors)[0] : result.error);
      return { id: result.data.id, notes: result.data.suggestions };
    });
  }

  const tabs: Array<{ id: Mode; label: string; icon: typeof FileUp }> = [
    { id: "upload", label: "Upload file", icon: FileUp },
    { id: "paste", label: "Paste text", icon: ClipboardPaste },
    { id: "scratch", label: "Start from scratch", icon: Sparkles },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="How to add your resume">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => {
              setMode(id);
              setError(null);
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium",
              mode === id
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {mode === "upload" ? (
          <form onSubmit={onUpload} className="space-y-4">
            <label
              htmlFor="resume-file"
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border px-6 py-10 text-center hover:border-primary hover:bg-primary-soft/30"
            >
              <UploadCloud className="h-8 w-8 text-primary" aria-hidden />
              <span className="mt-3 text-sm font-medium">{fileName ?? "Choose your resume"}</span>
              <span className="mt-1 text-xs text-muted-foreground">
                PDF or Word (.docx), up to 5 MB
              </span>
              <input
                ref={fileRef}
                id="resume-file"
                name="file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
              />
            </label>
            <Button type="submit" loading={pending} className="w-full sm:w-auto">
              {pending ? "Reading your resume…" : "Import resume"}
            </Button>
          </form>
        ) : null}

        {mode === "paste" ? (
          <form onSubmit={onPaste} className="space-y-4">
            <Field label="Resume text" htmlFor="resume-text">
              <Textarea
                id="resume-text"
                name="text"
                rows={12}
                required
                minLength={50}
                placeholder="Paste the full text of your resume…"
              />
            </Field>
            <Button type="submit" loading={pending}>
              {pending ? "Reading your resume…" : "Import resume"}
            </Button>
          </form>
        ) : null}

        {mode === "scratch" ? (
          <form onSubmit={onScratch} className="space-y-4">
            <Field label="Target role" htmlFor="targetRole">
              <Input
                id="targetRole"
                name="targetRole"
                required
                placeholder="e.g. Product Designer"
              />
            </Field>
            <Field
              label="Your background"
              htmlFor="background"
              hint="Jobs, dates, what you built or achieved, tools you use, education. Rough notes are fine — the AI will write it up."
            >
              <Textarea id="background" name="background" rows={10} required minLength={80} />
            </Field>
            <Button type="submit" loading={pending}>
              {pending ? "Writing your resume…" : "Write my resume"}
            </Button>
          </form>
        ) : null}

        {error ? (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        ) : null}
      </div>
    </div>
  );
}
