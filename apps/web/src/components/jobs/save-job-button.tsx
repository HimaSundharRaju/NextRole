"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveJob } from "@/app/(app)/jobs/actions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export function SaveJobButton({ jobId, saved }: { jobId: string; saved: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [isSaved, setIsSaved] = useState(saved);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isSaved || pending}
      onClick={() =>
        startTransition(async () => {
          const result = await saveJob({ jobId });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          setIsSaved(true);
          toast.success("Saved to your tracker.");
          router.refresh();
        })
      }
      className={cn(
        "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default",
        isSaved && "text-primary hover:bg-transparent hover:text-primary",
      )}
      aria-label={isSaved ? "Saved to tracker" : "Save to tracker"}
      title={isSaved ? "Saved to tracker" : "Save to tracker"}
    >
      {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
    </button>
  );
}
