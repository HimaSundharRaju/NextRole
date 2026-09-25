"use client";

import { Copy, FilePlus2, MoreHorizontal, Star, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ResumeImport } from "@/components/resume/resume-import";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { createBlankResume, duplicateResume, makePrimaryResume, removeResume } from "./actions";

export function NewResumeButtons() {
  const router = useRouter();
  const toast = useToast();
  const [importOpen, setImportOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="secondary" onClick={() => setImportOpen(true)}>
        <Upload className="h-4 w-4" aria-hidden /> Import
      </Button>
      <Button
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await createBlankResume({ title: "Untitled resume" });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            router.push(`/resumes/${result.data.id}`);
          })
        }
      >
        <FilePlus2 className="h-4 w-4" aria-hidden /> New resume
      </Button>
      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import a resume"
        description="PDF, Word or pasted text. The AI transcribes it exactly."
      >
        <ResumeImport
          makePrimary={false}
          onDone={(resume) => {
            setImportOpen(false);
            router.push(`/resumes/${resume.id}`);
          }}
        />
      </Dialog>
    </>
  );
}

export function ResumeRowMenu({ resumeId, isPrimary }: { resumeId: string; isPrimary: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function act(
    task: () => Promise<{ ok: boolean; error?: string; data?: unknown }>,
    success: string,
  ) {
    setOpen(false);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  return (
    <div className="relative z-10" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={pending}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
        aria-label="Resume actions"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-card py-1 text-sm shadow-lg">
          {!isPrimary ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted"
              onClick={() => act(() => makePrimaryResume({ resumeId }), "Main resume updated.")}
            >
              <Star className="h-4 w-4" aria-hidden /> Make main resume
            </button>
          ) : null}
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted"
            onClick={() => act(() => duplicateResume({ resumeId }), "Duplicated.")}
          >
            <Copy className="h-4 w-4" aria-hidden /> Duplicate
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-danger hover:bg-muted"
            onClick={() => {
              if (
                window.confirm("Delete this resume and its version history? This can't be undone.")
              ) {
                act(() => removeResume({ resumeId }), "Resume deleted.");
              }
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}
