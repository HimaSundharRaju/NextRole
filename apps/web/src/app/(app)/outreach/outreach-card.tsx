"use client";

import { CheckCircle2, Mail, MessageCircle, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { gmailComposeUrl } from "@/components/jobs/apply-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { editOutreach, markOutreachSent, removeOutreach } from "./actions";

export interface OutreachItem {
  id: string;
  channel: "email" | "linkedin";
  subject: string;
  body: string;
  recipientName: string;
  recipientEmail: string;
  status: "draft" | "sent";
  sentAt: string | null;
  context: string;
}

export function OutreachCard({ item }: { item: OutreachItem }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const [email, setEmail] = useState(item.recipientEmail);

  function act(task: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(success);
      setEditing(false);
      router.refresh();
    });
  }

  const Icon = item.channel === "email" ? Mail : MessageCircle;

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {item.channel === "email" ? subject || "(no subject)" : "LinkedIn connection note"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {item.context}
              {item.recipientName ? ` · to ${item.recipientName}` : ""}
            </p>
          </div>
        </div>
        {item.status === "sent" ? (
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" aria-hidden /> Sent {formatDate(item.sentAt)}
          </Badge>
        ) : (
          <Badge>Draft</Badge>
        )}
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          {item.channel === "email" ? (
            <>
              <Input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Recipient email"
                aria-label="Recipient email"
              />
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                aria-label="Subject"
              />
            </>
          ) : null}
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            aria-label="Message"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={pending}
              onClick={() =>
                act(
                  () => editOutreach({ id: item.id, subject, body, recipientEmail: email }),
                  "Saved.",
                )
              }
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{body}</p>
      )}

      {!editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyButton text={item.channel === "email" ? `${subject}\n\n${body}` : body} />
          {item.channel === "email" ? (
            <a
              href={gmailComposeUrl(email, subject, body)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
            >
              <Send className="h-3.5 w-3.5" aria-hidden /> Open in Gmail
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Edit
          </button>
          {item.status === "draft" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => act(() => markOutreachSent({ id: item.id }), "Marked as sent.")}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Mark as sent
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => act(() => removeOutreach({ id: item.id }), "Deleted.")}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-danger-soft hover:text-danger"
            aria-label="Delete draft"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </article>
  );
}
