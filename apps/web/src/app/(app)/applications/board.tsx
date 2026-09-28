"use client";

import type { ApplicationStatus } from "@gettargetrole/db/schema";
import { CalendarClock, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition, type DragEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { BOARD_COLUMNS, CLOSED_STATUSES, STATUS_META } from "@/lib/statuses";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { addApplication, moveApplication } from "./actions";

export interface BoardItem {
  id: string;
  companyName: string;
  jobTitle: string;
  location: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  nextActionAt: string | null;
  followUpDue: boolean;
  updatedAt: string;
}

function Card({ item, onMove }: { item: BoardItem; onMove: (status: ApplicationStatus) => void }) {
  const due = item.followUpDue;
  return (
    <div
      draggable
      onDragStart={(event: DragEvent) => event.dataTransfer.setData("text/plain", item.id)}
      className="cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm active:cursor-grabbing"
    >
      <Link
        href={`/applications/${item.id}`}
        className="block font-medium leading-snug hover:text-primary"
      >
        {item.jobTitle}
      </Link>
      <p className="mt-0.5 text-xs text-muted-foreground">{item.companyName}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px]",
            due ? "text-warning" : "text-muted-foreground",
          )}
        >
          {item.nextActionAt ? (
            <>
              <CalendarClock className="h-3 w-3" aria-hidden />{" "}
              {due ? "Follow up now" : `Follow up ${formatDate(item.nextActionAt)}`}
            </>
          ) : (
            `Updated ${timeAgo(item.updatedAt)}`
          )}
        </span>
        <select
          value={item.status}
          onChange={(event) => onMove(event.target.value as ApplicationStatus)}
          className="rounded border border-border bg-card px-1 py-0.5 text-[11px] text-muted-foreground"
          aria-label={`Status for ${item.jobTitle}`}
        >
          {Object.entries(STATUS_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ApplicationBoard({ items }: { items: BoardItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [optimistic, applyMove] = useOptimistic(
    items,
    (state, move: { id: string; status: ApplicationStatus }) =>
      state.map((item) => (item.id === move.id ? { ...item, status: move.status } : item)),
  );
  const [dragOver, setDragOver] = useState<ApplicationStatus | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function move(id: string, status: ApplicationStatus) {
    startTransition(async () => {
      applyMove({ id, status });
      const result = await moveApplication({ applicationId: id, status });
      if (!result.ok) toast.error(result.error);
      router.refresh();
    });
  }

  function onDrop(event: DragEvent, status: ApplicationStatus) {
    event.preventDefault();
    setDragOver(null);
    const id = event.dataTransfer.getData("text/plain");
    if (id) move(id, status);
  }

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startSaving(async () => {
      const result = await addApplication({
        companyName: String(form.get("companyName") ?? ""),
        jobTitle: String(form.get("jobTitle") ?? ""),
        jobUrl: String(form.get("jobUrl") ?? ""),
        location: String(form.get("location") ?? ""),
        status: String(form.get("status") ?? "applied") as ApplicationStatus,
        notes: String(form.get("notes") ?? ""),
      });
      if (!result.ok) {
        setFormError(result.fieldErrors ? Object.values(result.fieldErrors)[0]! : result.error);
        return;
      }
      setAdding(false);
      setFormError(null);
      toast.success("Application added.");
      router.refresh();
    });
  }

  const columns = showClosed ? [...BOARD_COLUMNS, ...CLOSED_STATUSES] : BOARD_COLUMNS;
  const closedCount = optimistic.filter((item) => CLOSED_STATUSES.includes(item.status)).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(event) => setShowClosed(event.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          Show closed ({closedCount})
        </label>
        <Button onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Add application
        </Button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((status) => {
          const columnItems = optimistic.filter((item) => item.status === status);
          return (
            <section
              key={status}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(status);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(event) => onDrop(event, status)}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40 p-3 transition-colors",
                dragOver === status ? "border-primary bg-primary-soft/40" : "border-border",
              )}
              aria-label={`${STATUS_META[status].label} column`}
            >
              <h2 className="mb-3 flex items-center justify-between text-sm font-semibold">
                {STATUS_META[status].label}
                <span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">
                  {columnItems.length}
                </span>
              </h2>
              <div className="flex min-h-24 flex-col gap-2">
                {columnItems.map((item) => (
                  <Card key={item.id} item={item} onMove={(next) => move(item.id, next)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="Add an application"
        description="Track a job you found elsewhere."
      >
        <form onSubmit={onAdd} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company" htmlFor="companyName">
              <Input id="companyName" name="companyName" required maxLength={120} />
            </Field>
            <Field label="Job title" htmlFor="jobTitle">
              <Input id="jobTitle" name="jobTitle" required maxLength={160} />
            </Field>
            <Field label="Job link" htmlFor="jobUrl">
              <Input id="jobUrl" name="jobUrl" type="url" placeholder="https://…" />
            </Field>
            <Field label="Location" htmlFor="location">
              <Input id="location" name="location" maxLength={120} />
            </Field>
          </div>
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue="applied">
              {Object.entries(STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={3} maxLength={5000} />
          </Field>
          {formError ? <Alert>{formError}</Alert> : null}
          <Button type="submit" loading={saving}>
            Add to tracker
          </Button>
        </form>
      </Dialog>
    </>
  );
}
