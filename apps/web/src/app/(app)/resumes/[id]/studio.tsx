"use client";

import type { Resume, ResumeSettings, TemplateId } from "@gettargetrole/resume/schema";
import { TEMPLATE_THEMES } from "@gettargetrole/resume/theme";
import {
  ArrowLeft,
  Download,
  MessageSquare,
  PenLine,
  ScanSearch,
  History,
  Star,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ScaledPreview } from "@/components/resume/scaled-preview";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  makePrimaryResume,
  renameResume,
  restoreResumeRevision,
  saveResume,
  saveResumeSettings,
} from "../actions";
import type { UnitAllowance } from "@/lib/plans";
import { AtsPanel } from "./ats-panel";
import { HistoryPanel, type RevisionItem } from "./history-panel";
import { ResumeEditor } from "./resume-editor";
import { StudioChat, type ChatMessage } from "./studio-chat";

type Tab = "chat" | "edit" | "ats" | "history";

export function ResumeStudio({
  resumeId,
  title,
  kind,
  isPrimary,
  initialResume,
  initialSettings,
  messages,
  revisions,
  job,
  studioAllowance,
}: {
  resumeId: string;
  title: string;
  kind: "master" | "tailored";
  isPrimary: boolean;
  initialResume: Resume;
  initialSettings: ResumeSettings;
  messages: ChatMessage[];
  revisions: RevisionItem[];
  job: { id: string; title: string; company: string; description: string } | null;
  studioAllowance: UnitAllowance;
}) {
  const router = useRouter();
  const toast = useToast();
  const [resume, setResume] = useState(initialResume);
  const [settings, setSettings] = useState(initialSettings);
  const [tab, setTab] = useState<Tab>("chat");
  const [editorVersion, setEditorVersion] = useState(0);
  const [saving, startSaving] = useTransition();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState(title);

  function replaceResume(next: Resume) {
    setResume(next);
    setEditorVersion((version) => version + 1);
  }

  function updateSettings(patch: Partial<ResumeSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveResumeSettings({ resumeId, settings: next }).then((result) => {
      if (!result.ok) toast.error(result.error);
    });
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof MessageSquare }> = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "edit", label: "Edit", icon: PenLine },
    { id: "ats", label: "ATS check", icon: ScanSearch },
    { id: "history", label: "History", icon: History },
  ];

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[36rem] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/resumes"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          aria-label="Back to resumes"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => {
            const next = titleDraft.trim();
            if (next && next !== title) void renameResume({ resumeId, title: next });
          }}
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-semibold hover:border-border focus:border-ring focus:outline-none sm:flex-none sm:w-80"
          aria-label="Resume title"
          maxLength={120}
        />
        {isPrimary ? (
          <Badge tone="primary">
            <Star className="h-3 w-3" aria-hidden /> Main resume
          </Badge>
        ) : kind === "tailored" ? (
          <Badge tone="outline">Tailored{job ? ` · ${job.company}` : ""}</Badge>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value={settings.template}
            onChange={(event) => updateSettings({ template: event.target.value as TemplateId })}
            className="h-9 w-auto"
            aria-label="Template"
          >
            {Object.values(TEMPLATE_THEMES).map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.label}
              </option>
            ))}
          </Select>
          {TEMPLATE_THEMES[settings.template].useAccent ? (
            <input
              type="color"
              value={settings.accentColor}
              onChange={(event) => updateSettings({ accentColor: event.target.value })}
              className="h-9 w-10 cursor-pointer rounded-md border border-input bg-card p-1"
              aria-label="Accent color"
            />
          ) : null}
          <Select
            value={String(settings.fontScale)}
            onChange={(event) => updateSettings({ fontScale: Number(event.target.value) })}
            className="h-9 w-auto"
            aria-label="Text size"
          >
            <option value="0.92">Compact text</option>
            <option value="1">Normal text</option>
            <option value="1.08">Large text</option>
          </Select>
          <Select
            value={settings.paperSize}
            onChange={(event) =>
              updateSettings({ paperSize: event.target.value as "LETTER" | "A4" })
            }
            className="h-9 w-auto"
            aria-label="Paper size"
          >
            <option value="LETTER">Letter</option>
            <option value="A4">A4</option>
          </Select>
          <a
            href={`/api/resumes/${resumeId}/export?format=pdf`}
            className={buttonVariants({ size: "sm" })}
          >
            <Download className="h-4 w-4" aria-hidden /> PDF
          </a>
          <a
            href={`/api/resumes/${resumeId}/export?format=docx`}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <Download className="h-4 w-4" aria-hidden /> Word
          </a>
          {!isPrimary ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const result = await makePrimaryResume({ resumeId });
                if (result.ok) {
                  toast.success("This is now your main resume.");
                  router.refresh();
                } else toast.error(result.error);
              }}
            >
              <Star className="h-4 w-4" aria-hidden /> Make main
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(20rem,28rem)_minmax(0,1fr)]">
        <div className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex border-b border-border" role="tablist" aria-label="Studio tools">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-3 text-xs font-medium sm:text-sm",
                  tab === id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            <div className={cn("h-full", tab !== "chat" && "hidden")}>
              <StudioChat
                resumeId={resumeId}
                initialMessages={messages}
                hasJob={Boolean(job)}
                allowance={studioAllowance}
                onResume={(next) => replaceResume(next)}
                onComplete={(changed) => {
                  if (changed) router.refresh();
                }}
              />
            </div>
            {tab === "edit" ? (
              <ResumeEditor
                key={editorVersion}
                initial={resume}
                saving={saving}
                onSave={(next) =>
                  startSaving(async () => {
                    const result = await saveResume({ resumeId, content: next });
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    replaceResume(result.data.content);
                    toast.success("Saved.");
                    router.refresh();
                  })
                }
              />
            ) : null}
            {tab === "ats" ? (
              <AtsPanel resume={resume} jobDescription={job?.description ?? null} />
            ) : null}
            {tab === "history" ? (
              <HistoryPanel
                revisions={revisions}
                restoringId={restoringId}
                onRestore={async (revisionId) => {
                  setRestoringId(revisionId);
                  const result = await restoreResumeRevision({ resumeId, revisionId });
                  setRestoringId(null);
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  replaceResume(result.data.content);
                  toast.success("Restored that version.");
                  router.refresh();
                }}
              />
            ) : null}
          </div>
        </div>

        <ScaledPreview resume={resume} settings={settings} />
      </div>
    </div>
  );
}
