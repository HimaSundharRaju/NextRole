"use client";

import type { ClientSkipReason } from "@gettargetrole/db";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  answerSpecialistQuestion,
  decideSpecialistProposals,
} from "@/app/(app)/applications/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

const SKIP_LABEL: Record<ClientSkipReason, string> = {
  company: "Not this company",
  location: "Location",
  pay: "Pay too low",
  not_a_fit: "Not a fit",
  other: "Other",
};

export interface ProposalView {
  id: string;
  jobTitle: string;
  companyName: string;
  location: string;
  pay: string | null;
  score: number | null;
  note: string;
  proposedByName: string | null;
}

export interface QuestionView {
  id: string;
  question: string;
  jobTitle: string | null;
  companyName: string | null;
}

/** Jobs the specialist proposed, and questions waiting on the client. */
export function FromSpecialist({
  specialistName,
  proposals,
  questions,
}: {
  specialistName: string;
  proposals: ProposalView[];
  questions: QuestionView[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, ClientSkipReason>>({});
  const [answers, setAnswers] = useState<Record<string, { text: string; save: boolean }>>({});
  if (proposals.length === 0 && questions.length === 0) return null;

  const decide = (
    applicationIds: string[],
    decision: "approve" | "skip",
    reason?: ClientSkipReason,
  ) =>
    startTransition(async () => {
      const result = await decideSpecialistProposals({ applicationIds, decision, reason });
      if (!result.ok) toast.error(result.error);
      setPicked([]);
      router.refresh();
    });

  return (
    <section
      aria-label="From your specialist"
      className="mb-6 space-y-3 rounded-xl border border-primary/40 bg-primary-soft/30 p-4"
    >
      <h2 className="font-semibold">From {specialistName}</h2>
      {questions.map((question) => {
        const answer = answers[question.id] ?? { text: "", save: true };
        return (
          <div key={question.id} className="rounded-lg border border-border bg-card p-3 text-sm">
            <p className="font-medium">{question.question}</p>
            {question.jobTitle ? (
              <p className="text-xs text-muted-foreground">
                For {question.jobTitle} at {question.companyName}
              </p>
            ) : null}
            <Textarea
              className="mt-2"
              rows={2}
              value={answer.text}
              aria-label="Your answer"
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [question.id]: { ...answer, text: event.target.value },
                }))
              }
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={answer.save}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: { ...answer, save: event.target.checked },
                  }))
                }
              />
              Save for future applications
            </label>
            <Button
              size="sm"
              className="mt-2"
              disabled={!answer.text.trim()}
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await answerSpecialistQuestion({
                    taskId: question.id,
                    answer: answer.text,
                    saveToBank: answer.save,
                  });
                  if (!result.ok) toast.error(result.error);
                  else toast.success("Thanks — your specialist will take it from here.");
                  router.refresh();
                })
              }
            >
              Send answer
            </Button>
          </div>
        );
      })}
      {proposals.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Approve the jobs you want {specialistName} to apply to.
            </p>
            <Button
              size="sm"
              disabled={picked.length === 0}
              loading={pending}
              onClick={() => decide(picked, "approve")}
            >
              Approve selected ({picked.length})
            </Button>
          </div>
          {proposals.map((proposal) => (
            <div
              key={proposal.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm"
            >
              <input
                type="checkbox"
                aria-label={`Select ${proposal.jobTitle}`}
                checked={picked.includes(proposal.id)}
                onChange={(event) =>
                  setPicked((current) =>
                    event.target.checked
                      ? [...current, proposal.id]
                      : current.filter((id) => id !== proposal.id),
                  )
                }
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{proposal.jobTitle}</p>
                <p className="text-xs text-muted-foreground">
                  {proposal.companyName} · {proposal.location}
                  {proposal.pay ? ` · ${proposal.pay}` : ""}
                </p>
                {proposal.note ? <p className="text-xs">“{proposal.note}”</p> : null}
              </div>
              {proposal.score !== null ? (
                <Badge tone="primary">{proposal.score}% match</Badge>
              ) : null}
              <Button size="sm" loading={pending} onClick={() => decide([proposal.id], "approve")}>
                Approve
              </Button>
              <Select
                aria-label={`Why skip ${proposal.jobTitle}`}
                className="h-8 w-40 text-xs"
                value={reasons[proposal.id] ?? ""}
                onChange={(event) =>
                  setReasons((current) => ({
                    ...current,
                    [proposal.id]: event.target.value as ClientSkipReason,
                  }))
                }
              >
                <option value="">Skip because…</option>
                {(Object.keys(SKIP_LABEL) as ClientSkipReason[]).map((reason) => (
                  <option key={reason} value={reason}>
                    {SKIP_LABEL[reason]}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!reasons[proposal.id]}
                loading={pending}
                onClick={() => decide([proposal.id], "skip", reasons[proposal.id])}
              >
                Skip
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
