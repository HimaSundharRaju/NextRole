"use client";

import type { Plan } from "@gettargetrole/db/schema";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { PLANS } from "@/lib/plans";
import {
  deleteUserForCase,
  resendVerification,
  sendExportLink,
  sendPasswordReset,
  setBanForUser,
  setPlanForUser,
} from "./actions";
import { useCareAction, type ActionOutcome } from "./use-care-action";

/** One account action: a short description, a reason (always required) and a button. */
function ReasonAction({
  title,
  description,
  button,
  success,
  danger,
  disabled,
  disabledNote,
  extra,
  onRun,
}: {
  title: string;
  description?: string;
  button: string;
  success: string;
  danger?: boolean;
  disabled?: boolean;
  disabledNote?: string;
  extra?: ReactNode;
  onRun: (reason: string) => Promise<ActionOutcome>;
}) {
  const { pending, run } = useCareAction();
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        {disabled && disabledNote ? <p className="text-xs text-danger">{disabledNote}</p> : null}
      </div>
      {extra}
      <div className="flex flex-wrap gap-2">
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          placeholder="Why? (kept in the audit log)"
          aria-label={`Reason: ${title}`}
          disabled={disabled}
          className="h-9 min-w-56 flex-1"
        />
        <Button
          size="sm"
          variant={danger ? "danger" : "secondary"}
          disabled={disabled || !reason.trim()}
          loading={pending}
          onClick={() =>
            run(
              () => onRun(reason),
              success,
              () => setReason(""),
            )
          }
        >
          {button}
        </Button>
      </div>
    </div>
  );
}

interface Common {
  userId: string;
  caseId?: string;
}

function PlanAction({ userId, caseId, plan }: Common & { plan: Plan }) {
  const [next, setNext] = useState<Plan>(plan);
  return (
    <ReasonAction
      title="Change plan"
      description="Assigning a specialist stays in Admin → Concierge."
      button="Change plan"
      success="Plan changed."
      disabled={next === plan}
      extra={
        <Select
          aria-label="New plan"
          value={next}
          onChange={(event) => setNext(event.target.value as Plan)}
          className="h-9 w-48"
        >
          {Object.values(PLANS).map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      }
      onRun={(reason) => setPlanForUser({ userId, caseId, plan: next, reason })}
    />
  );
}

function DeleteAction({
  userId,
  caseId,
  email,
  deletable,
}: Common & { email: string; deletable: boolean }) {
  const { pending, run } = useCareAction();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const ready = Boolean(caseId) && deletable;
  return (
    <div className="space-y-2 rounded-lg border border-danger/40 p-3">
      <div>
        <p className="text-sm font-medium">Delete account</p>
        <p className="text-xs text-muted-foreground">
          For a &quot;My data&quot; request this account made itself. Everything is deleted, and the
          request stays as a record.
        </p>
        {ready ? null : (
          <p className="text-xs text-danger">
            This needs an open, confirmed &quot;My data&quot; request from this account. Open the
            account from that request.
          </p>
        )}
      </div>
      <Input
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        placeholder={`Type ${email} to confirm`}
        aria-label="Type their email to confirm"
        disabled={!ready}
        className="h-9"
      />
      <div className="flex flex-wrap gap-2">
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          placeholder="Why? (kept in the audit log)"
          aria-label="Reason: Delete account"
          disabled={!ready}
          className="h-9 min-w-56 flex-1"
        />
        <Button
          size="sm"
          variant="danger"
          disabled={!ready || !reason.trim() || !confirm.trim()}
          loading={pending}
          onClick={() =>
            run(
              () => deleteUserForCase({ userId, caseId: caseId!, reason, confirmEmail: confirm }),
              "Account deleted.",
            )
          }
        >
          Delete account
        </Button>
      </div>
    </div>
  );
}

/** Everything an agent can do to an account, each with a reason; the page decides who sees it. */
export function AccountActions({
  userId,
  caseId,
  email,
  emailVerified,
  banned,
  plan,
  deletable,
}: Common & {
  email: string;
  emailVerified: boolean;
  banned: boolean;
  plan: Plan;
  deletable: boolean;
}) {
  return (
    <div className="space-y-3">
      <PlanAction userId={userId} caseId={caseId} plan={plan} />
      <ReasonAction
        title={banned ? "Unban account" : "Ban account"}
        description={
          banned
            ? "They can sign in again."
            : "Signs them out everywhere at once and stops them signing in."
        }
        button={banned ? "Unban" : "Ban"}
        success={banned ? "Account unbanned." : "Account banned."}
        danger={!banned}
        onRun={(reason) => setBanForUser({ userId, caseId, banned: !banned, reason })}
      />
      <ReasonAction
        title="Resend verification email"
        description="Only for accounts whose email isn't verified yet."
        button="Send email"
        success="Verification email sent."
        disabled={emailVerified}
        disabledNote="Their email is already verified."
        onRun={(reason) => resendVerification({ userId, caseId, reason })}
      />
      <ReasonAction
        title="Send password reset email"
        description="The usual reset link, valid for 1 hour. With unbanning, this covers “unlock”."
        button="Send email"
        success="Password reset email sent."
        onRun={(reason) => sendPasswordReset({ userId, caseId, reason })}
      />
      <ReasonAction
        title="Send data export link"
        description="Emails them a single-use link, valid for 24 hours, to download their data."
        button="Send link"
        success="Export link sent."
        onRun={(reason) => sendExportLink({ userId, caseId, reason })}
      />
      <DeleteAction userId={userId} caseId={caseId} email={email} deletable={deletable} />
    </div>
  );
}
