"use client";

import type { ApplicationStatus, BankAnswer } from "@gettargetrole/db/schema";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { StatusOptions } from "@/components/applications/status-options";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import {
  addClientApplication,
  addExternalProposal,
  addStaffNoteToApplication,
  askClientQuestion,
  confirmClientInbox,
  moveClientApplication,
  proposeJobsToClient,
  saveClientAnswerBank,
} from "../actions";

export function ClientStatusSelect({
  clientId,
  applicationId,
  status,
}: {
  clientId: string;
  applicationId: string;
  status: ApplicationStatus;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Select
      defaultValue={status}
      disabled={pending}
      className="h-8 w-36 text-xs"
      aria-label="Status"
      onChange={(event) =>
        startTransition(async () => {
          const result = await moveClientApplication({
            clientId,
            applicationId,
            status: event.target.value as ApplicationStatus,
          });
          if (!result.ok) toast.error(result.error);
          router.refresh();
        })
      }
    >
      <StatusOptions current={status} />
    </Select>
  );
}

export function AddForClientForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      const result = await addClientApplication({
        clientId,
        companyName: String(form.get("companyName") ?? ""),
        jobTitle: String(form.get("jobTitle") ?? ""),
        jobUrl: String(form.get("jobUrl") ?? ""),
        location: String(form.get("location") ?? ""),
      });
      if (!result.ok) {
        toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0]! : result.error);
        return;
      }
      formElement.reset();
      toast.success("Application logged for your client.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-2">
      <Input name="companyName" placeholder="Company" required aria-label="Company" />
      <Input name="jobTitle" placeholder="Job title" required aria-label="Job title" />
      <Input name="jobUrl" placeholder="https://…" aria-label="Job link" />
      <Input name="location" placeholder="Location" aria-label="Location" />
      <Button type="submit" loading={pending} className="sm:col-span-2 sm:w-fit">
        Log application
      </Button>
    </form>
  );
}

/** Proposes a job found outside the board, with its pasted description. */
export function ExternalProposalForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    startTransition(async () => {
      const result = await addExternalProposal({
        clientId,
        companyName: String(form.get("companyName") ?? ""),
        jobTitle: String(form.get("jobTitle") ?? ""),
        jobUrl: String(form.get("jobUrl") ?? ""),
        location: String(form.get("location") ?? ""),
        jobDescription: String(form.get("jobDescription") ?? ""),
        note: String(form.get("note") ?? "") || undefined,
      });
      if (!result.ok) {
        toast.error(result.fieldErrors ? Object.values(result.fieldErrors)[0]! : result.error);
        return;
      }
      formElement.reset();
      toast.success("Proposed to the client.");
      router.refresh();
    });
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-2">
      <Input name="companyName" placeholder="Company" required aria-label="Company" />
      <Input name="jobTitle" placeholder="Job title" required aria-label="Job title" />
      <Input name="jobUrl" placeholder="https://… link to the posting" aria-label="Job link" />
      <Input name="location" placeholder="Location" aria-label="Location" />
      <Textarea
        name="jobDescription"
        placeholder="Paste the job description"
        required
        rows={4}
        className="sm:col-span-2"
        aria-label="Job description"
      />
      <Input
        name="note"
        maxLength={200}
        placeholder="Note to the client (optional)"
        className="sm:col-span-2"
        aria-label="Note to the client"
      />
      <Button type="submit" loading={pending} className="sm:col-span-2 sm:justify-self-start">
        Propose to client
      </Button>
    </form>
  );
}

export function ProposeJobsForm({
  clientId,
  jobs,
}: {
  clientId: string;
  jobs: Array<{
    id: string;
    title: string;
    companyName: string;
    location: string;
    score: number;
    status: string | null;
  }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center gap-3 px-3 py-2">
            <input
              type="checkbox"
              aria-label={`Propose ${job.title}`}
              disabled={Boolean(job.status)}
              checked={picked.includes(job.id)}
              onChange={(event) =>
                setPicked((current) =>
                  event.target.checked
                    ? [...current, job.id]
                    : current.filter((id) => id !== job.id),
                )
              }
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{job.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {job.companyName} · {job.location}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {job.status ? job.status : `${job.score}% match`}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
          placeholder="Note to the client (optional)"
          aria-label="Note to the client"
          className="max-w-md"
        />
        <Button
          disabled={picked.length === 0}
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await proposeJobsToClient({
                clientId,
                jobIds: picked,
                note: note || undefined,
              });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              const { created, existing } = result.data;
              toast.success(
                existing > 0
                  ? `Proposed ${created}; ${existing} already in their tracker.`
                  : `Proposed ${created} job${created === 1 ? "" : "s"} to the client.`,
              );
              setPicked([]);
              setNote("");
              router.refresh();
            })
          }
        >
          Propose to client ({picked.length})
        </Button>
      </div>
    </div>
  );
}

export function ConfirmInboxButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await confirmClientInbox({ clientId });
          if (!result.ok) toast.error(result.error);
          else toast.success("Inbox access confirmed.");
          router.refresh();
        })
      }
    >
      I can open their inbox
    </Button>
  );
}

export function AnswerBankEditor({ clientId, bank }: { clientId: string; bank: BankAnswer[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState([
    ...bank.map(({ question, answer }) => ({ question, answer })),
    { question: "", answer: "" },
  ]);
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-2">
          <Input
            value={row.question}
            onChange={(event) =>
              setRows((current) =>
                current.map((item, i) =>
                  i === index ? { ...item, question: event.target.value } : item,
                ),
              )
            }
            placeholder="Question, e.g. Notice period?"
            aria-label={`Question ${index + 1}`}
          />
          <Input
            value={row.answer}
            onChange={(event) =>
              setRows((current) =>
                current.map((item, i) =>
                  i === index ? { ...item, answer: event.target.value } : item,
                ),
              )
            }
            placeholder="The client's answer"
            aria-label={`Answer ${index + 1}`}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setRows((current) => [...current, { question: "", answer: "" }])}
        >
          Add a row
        </Button>
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await saveClientAnswerBank({ clientId, answers: rows });
              if (!result.ok) toast.error(result.error);
              else toast.success("Answer bank saved.");
              router.refresh();
            })
          }
        >
          Save answers
        </Button>
      </div>
    </div>
  );
}

export function AskClientForm({
  clientId,
  applicationId,
}: {
  clientId: string;
  applicationId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  return (
    <div className="space-y-2">
      <Label htmlFor="ask-client">Ask the client</Label>
      <Textarea
        id="ask-client"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Something only they know, e.g. expected salary"
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={question.trim().length < 3}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await askClientQuestion({ clientId, applicationId, question });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Question sent. The application waits for their answer.");
            setQuestion("");
            router.refresh();
          })
        }
      >
        Ask client
      </Button>
    </div>
  );
}

export function StaffNoteForm({
  clientId,
  applicationId,
}: {
  clientId: string;
  applicationId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <Label htmlFor="staff-note">Staff note (the client never sees it)</Label>
      <Textarea
        id="staff-note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        rows={2}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={!note.trim()}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await addStaffNoteToApplication({ clientId, applicationId, note });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            setNote("");
            router.refresh();
          })
        }
      >
        Add note
      </Button>
    </div>
  );
}
