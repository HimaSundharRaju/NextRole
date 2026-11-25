"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { confirmRequest, replyToRequest } from "../../actions";

/** The reply box under a request's thread; `accessKey` is the private link's key, when used. */
export function ReplyBox({ caseId, accessKey }: { caseId: string; accessKey?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await replyToRequest({ caseId, message, key: accessKey });
      if (!result.ok) {
        setError(result.fieldErrors?.message ?? result.error);
        return;
      }
      setError(null);
      setMessage("");
      toast.success("Reply sent.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Textarea
        aria-label="Your reply"
        rows={4}
        maxLength={5000}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder="Write your reply"
      />
      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" loading={pending} disabled={!message.trim()}>
        Send reply
      </Button>
    </form>
  );
}

/** "Yes, I made this request": the private link proves the mailbox is theirs. */
export function ConfirmButton({ caseId, accessKey }: { caseId: string; accessKey: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await confirmRequest({ caseId, key: accessKey });
          if (!result.ok) toast.error(result.error);
          else toast.success("Thanks — we'll carry on.");
          router.refresh();
        })
      }
    >
      Yes, I made this request
    </Button>
  );
}
