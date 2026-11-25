"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "@/components/ui/toast";

export type ActionOutcome = { ok: true } | { ok: false; error: string };

/** Runs a care action, then shows its toast and refreshes the page. */
export function useCareAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const run = (task: () => Promise<ActionOutcome>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await task();
      if (!result.ok) toast.error(result.error);
      else {
        toast.success(success);
        after?.();
      }
      router.refresh();
    });
  return { pending, run };
}
