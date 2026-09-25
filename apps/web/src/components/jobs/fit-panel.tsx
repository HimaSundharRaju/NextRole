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
}: {
  jobId: string;
  quick: { score: number; matchedSkills: string[]; missingSkills: string[]; reasons: string[] };
  aiMatch: AiMatch | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AiMatch | null>(aiMatch);

  function run() {
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
              <span className="text-xs text-muted-foreground">Claude&apos;s assessment</span>
            </div>
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
        <Button variant="secondary" className="w-full" onClick={run} loading={pending}>
          <Sparkles className="h-4 w-4" aria-hidden />{" "}
          {analysis ? "Re-analyze with Claude" : "Analyze my fit with Claude"}
        </Button>
      </CardBody>
    </Card>
  );
}
