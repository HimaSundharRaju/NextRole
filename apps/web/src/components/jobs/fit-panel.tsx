"use client";

import { skillLabel } from "@gettargetrole/resume/skills";
import { CheckCircle2, CircleAlert, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { analyzeFit } from "@/app/(app)/jobs/actions";
import { Badge, MatchBadge, scoreTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { AllowanceNote } from "@/components/usage/usage-bars";
import type { UnitAllowance } from "@/lib/plans";

/** Jobs below this match ask before spending an AI analysis (MIN_AI_MATCH in the plans). */
const LOW_MATCH = 70;

interface AiMatch {
  score: number;
  verdict: string;
  summary: string;
  strengths: string[];
  gaps: string[];
}

export function FitPanel({
  jobId,
  quick,
  aiMatch,
  stale = false,
  allowance,
}: {
  jobId: string;
  quick: { score: number; matchedSkills: string[]; missingSkills: string[]; reasons: string[] };
  aiMatch: AiMatch | null;
  /** The AI assessment was made from an earlier version of the main resume. */
  stale?: boolean;
  allowance: UnitAllowance;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AiMatch | null>(aiMatch);
  const [outdated, setOutdated] = useState(stale);
  const [confirmLowMatch, setConfirmLowMatch] = useState(false);

  function run() {
    setConfirmLowMatch(false);
    setError(null);
    startTransition(async () => {
      const result = await analyzeFit({ jobId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAnalysis({
        score: result.data.score,
        verdict: result.data.verdict,
        summary: `${result.data.summary} ${result.data.recommendation}`,
        strengths: result.data.strengths,
        gaps: result.data.gaps,
      });
      setOutdated(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader title="Your fit" action={<MatchBadge score={analysis?.score ?? quick.score} />} />
      <CardBody className="space-y-4 text-sm">
        {analysis ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={scoreTone(analysis.score)} className="capitalize">
                {analysis.verdict} fit
              </Badge>
              <span className="text-xs text-muted-foreground">AI assessment</span>
            </div>
            {outdated ? (
              <p className="text-xs text-warning">
                Made from an earlier version of your main resume. Re-analyze to update it.
              </p>
            ) : null}
            <p>{analysis.summary}</p>
            {analysis.strengths.length ? (
              <ul className="space-y-1.5">
                {analysis.strengths.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />{" "}
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
            {analysis.gaps.length ? (
              <ul className="space-y-1.5">
                {analysis.gaps.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />{" "}
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            {quick.reasons.length ? (
              <p className="text-muted-foreground">{quick.reasons.join(" · ")}</p>
            ) : null}
            {quick.matchedSkills.length ? (
              <p>
                <span className="font-medium">You have: </span>
                <span>{quick.matchedSkills.map(skillLabel).join(", ")}</span>
              </p>
            ) : null}
            {quick.missingSkills.length ? (
              <p>
                <span className="font-medium">They also want: </span>
                <span>{quick.missingSkills.map(skillLabel).join(", ")}</span>
              </p>
            ) : null}
          </div>
        )}
        {error ? <Alert>{error}</Alert> : null}
        {confirmLowMatch ? (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs">
            <p>
              This job is a {quick.score}% match on skills, title and location. Use 1 of your{" "}
              {allowance.left} AI analyses anyway?
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={run}>
                Analyze anyway
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmLowMatch(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() =>
              !analysis && quick.score < LOW_MATCH ? setConfirmLowMatch(true) : run()
            }
            loading={pending}
            disabled={allowance.left === 0}
          >
            <Sparkles className="h-4 w-4" aria-hidden />{" "}
            {analysis ? "Re-analyze with AI" : "Analyze my fit with AI"}
          </Button>
        )}
        <AllowanceNote allowance={allowance} />
      </CardBody>
    </Card>
  );
}
