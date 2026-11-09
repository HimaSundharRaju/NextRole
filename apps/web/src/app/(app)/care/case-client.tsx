"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/form";
import {
  addCaseNote,
  handOffCase,
  reopenCaseAction,
  replyToCase,
  solveCaseAction,
  takeCaseAction,
} from "./actions";
import { useCareAction } from "./use-care-action";

export function TakeButton({ caseId }: { caseId: string }) {
  const { pending, run } = useCareAction();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() => run(() => takeCaseAction({ caseId }), "It's yours now.")}
    >
      Take it
    </Button>
  );
}

export function HandOffForm({
  caseId,
  agents,
}: {
  caseId: string;
  agents: Array<{ id: string; name: string }>;
}) {
  const { pending, run } = useCareAction();
  const [toAgentId, setToAgentId] = useState("");
  return (
    <div className="flex items-center gap-2">
      <Select
        aria-label="Hand off to"
        value={toAgentId}
        onChange={(event) => setToAgentId(event.target.value)}
        className="h-8 w-40 text-xs"
      >
        <option value="">Hand off to…</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="secondary"
        disabled={!toAgentId}
        loading={pending}
        onClick={() => run(() => handOffCase({ caseId, toAgentId }), "Handed off.")}
      >
        Hand off
      </Button>
    </div>
  );
}

export function SolveButton({ caseId }: { caseId: string }) {
  const { pending, run } = useCareAction();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() => run(() => solveCaseAction({ caseId }), "Marked solved.")}
    >
      Solve
    </Button>
  );
}

export function ReopenButton({ caseId }: { caseId: string }) {
  const { pending, run } = useCareAction();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() => run(() => reopenCaseAction({ caseId }), "Reopened.")}
    >
      Reopen
    </Button>
  );
}

/** One box, two buttons: a reply goes to the requester, a note stays with staff. */
export function CaseReplyBox({ caseId, solved }: { caseId: string; solved: boolean }) {
  const { pending, run } = useCareAction();
  const [message, setMessage] = useState("");
  const clear = () => setMessage("");
  return (
    <div className="space-y-2">
      <Textarea
        aria-label="Reply or note"
        rows={4}
        maxLength={5000}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Write a reply for the requester, or a note for staff"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!message.trim()}
          loading={pending}
          onClick={() => run(() => replyToCase({ caseId, message }), "Reply sent.", clear)}
        >
          Send reply
        </Button>
        <Button
          variant="secondary"
          disabled={!message.trim()}
          loading={pending}
          onClick={() => run(() => addCaseNote({ caseId, message }), "Note added.", clear)}
        >
          Add note
        </Button>
        <p className="text-xs text-muted-foreground">
          Replies are emailed to the requester. Notes are only for staff.
          {solved ? " Replying reopens this request." : ""}
        </p>
      </div>
    </div>
  );
}
