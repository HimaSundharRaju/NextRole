"use client";

import { analyzeResume } from "@gettargetrole/resume/ats";
import type { Resume } from "@gettargetrole/resume/schema";
import { skillLabel } from "@gettargetrole/resume/skills";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, scoreTone } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/form";
import { ProgressBar } from "@/components/ui/misc";

const SEVERITY_ICON = { high: AlertTriangle, medium: Info, low: Info } as const;
const SEVERITY_CLASS = {
  high: "text-danger",
  medium: "text-warning",
  low: "text-muted-foreground",
} as const;

export function AtsPanel({
  resume,
  jobDescription,
}: {
  resume: Resume;
  jobDescription: string | null;
}) {
  const [pasted, setPasted] = useState("");
  const description = jobDescription ?? pasted;
  const report = useMemo(
    () => analyzeResume(resume, description || undefined),
    [resume, description],
  );

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4 text-sm">
      <div>
        <div className="flex items-center justify-between">
          <p className="font-semibold">ATS readiness</p>
          <Badge tone={scoreTone(report.score)}>{report.score}/100</Badge>
        </div>
        <ProgressBar value={report.score} className="mt-2" />
        <p className="mt-2 text-xs text-muted-foreground">
          {report.stats.wordCount} words · about {report.stats.estimatedPages} page
          {report.stats.estimatedPages > 1 ? "s" : ""} · {report.stats.quantifiedBullets}/
          {report.stats.bulletCount} bullets quantified
        </p>
      </div>

      {jobDescription ? (
        <p className="rounded-lg bg-primary-soft px-3 py-2 text-xs text-primary">
          Checking keywords against the job this resume is tailored for.
        </p>
      ) : (
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Paste a job description to check keyword coverage
          </span>
          <Textarea value={pasted} onChange={(event) => setPasted(event.target.value)} rows={4} />
        </label>
      )}

      {report.keywordCoverage !== null ? (
        <div className="space-y-2">
          <p className="font-medium">
            Keyword coverage: {Math.round(report.keywordCoverage * 100)}%
          </p>
          {report.matchedKeywords.length ? (
            <div className="flex flex-wrap gap-1.5">
              {report.matchedKeywords.map((keyword) => (
                <Badge key={keyword} tone="success">
                  {skillLabel(keyword)}
                </Badge>
              ))}
            </div>
          ) : null}
          {report.missingKeywords.length ? (
            <div className="flex flex-wrap gap-1.5">
              {report.missingKeywords.map((keyword) => (
                <Badge key={keyword} tone="outline">
                  {skillLabel(keyword)}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <p className="mb-2 font-medium">Suggestions</p>
        {report.issues.length === 0 ? (
          <p className="flex items-center gap-2 text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Looks great — no issues found.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.issues.map((issue, index) => {
              const Icon = SEVERITY_ICON[issue.severity];
              return (
                <li key={index} className="flex gap-2">
                  <Icon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${SEVERITY_CLASS[issue.severity]}`}
                    aria-hidden
                  />
                  <span>
                    <span className="font-medium">{issue.section}: </span>
                    {issue.message}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
