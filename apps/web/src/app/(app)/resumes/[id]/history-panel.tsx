"use client";

import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { timeAgo } from "@/lib/utils";

export interface RevisionItem {
  id: string;
  source: string;
  note: string;
  createdAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "You",
  ai_chat: "AI (chat)",
  ai_generate: "AI",
  ai_tailor: "AI (tailoring)",
  import: "Import",
  restore: "Restore",
};

export function HistoryPanel({
  revisions,
  restoringId,
  onRestore,
}: {
  revisions: RevisionItem[];
  restoringId: string | null;
  onRestore: (revisionId: string) => void;
}) {
  if (revisions.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No versions yet"
        description="Every edit, yours or the AI's, is saved here."
      />
    );
  }
  return (
    <ol className="h-full space-y-2 overflow-y-auto p-4">
      {revisions.map((revision, index) => (
        <li
          key={revision.id}
          className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <div className="min-w-0">
            <p className="font-medium">{revision.note || "Edit"}</p>
            <p className="text-xs text-muted-foreground">
              {SOURCE_LABEL[revision.source] ?? revision.source} · {timeAgo(revision.createdAt)}
            </p>
          </div>
          {index === 0 ? (
            <span className="shrink-0 text-xs text-muted-foreground">Current</span>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              loading={restoringId === revision.id}
              onClick={() => onRestore(revision.id)}
            >
              Restore
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}
