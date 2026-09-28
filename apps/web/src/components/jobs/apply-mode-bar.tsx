import { Wand2 } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** How the user applies: auto-prepare for strong new matches, or manually from any job. */
export function ApplyModeBar({
  autoPrepare,
  readyCount,
}: {
  autoPrepare: {
    /** Whether the user's plan includes auto-prepare. */
    included: boolean;
    enabled: boolean;
    minScore: number;
    dailyLimit: number;
  };
  readyCount: number;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="flex gap-2">
        <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        {!autoPrepare.included ? (
          <span>
            <span className="font-medium">Apply manually from any job</span>, or paste a job
            description from anywhere. Auto-prepare, which gets your best new matches ready to
            submit every day, comes with Pro.
          </span>
        ) : autoPrepare.enabled ? (
          <span>
            <span className="font-medium">Auto-prepare is on.</span> New jobs that are a{" "}
            {autoPrepare.minScore}%+ match get a tailored resume and cover letter, up to{" "}
            {autoPrepare.dailyLimit} a day. You review and submit.
          </span>
        ) : (
          <span>
            <span className="font-medium">Apply manually from any job</span>, or turn on
            auto-prepare to get your best new matches ready to submit.
          </span>
        )}
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        {readyCount > 0 ? (
          <Link href="/applications" className={buttonVariants({ size: "sm" })}>
            {readyCount} ready to apply
          </Link>
        ) : null}
        <Link
          href={autoPrepare.included ? "/settings#auto-prepare" : "/settings#plan"}
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          {!autoPrepare.included
            ? "Compare plans"
            : autoPrepare.enabled
              ? "Auto-prepare settings"
              : "Turn on auto-prepare"}
        </Link>
      </div>
    </div>
  );
}
