"use client";

import type { ApplicationStatus } from "@gettargetrole/db/schema";
import { useRouter } from "next/navigation";
import { useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { STATUS_META } from "@/lib/statuses";
import { addClientApplication, moveClientApplication } from "../actions";

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
      {Object.entries(STATUS_META).map(([value, meta]) => (
        <option key={value} value={value}>
          {meta.label}
        </option>
      ))}
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
