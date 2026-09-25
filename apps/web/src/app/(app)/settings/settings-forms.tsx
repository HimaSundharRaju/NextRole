"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { authClient } from "@/lib/auth-client";
import type { AboutInput } from "@/lib/validation";
import { deleteAccount, saveAbout } from "./actions";

export function AboutForm({ initial }: { initial: AboutInput }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveAbout({
        headline: String(form.get("headline") ?? ""),
        phone: String(form.get("phone") ?? ""),
        linkedinUrl: String(form.get("linkedinUrl") ?? ""),
        githubUrl: String(form.get("githubUrl") ?? ""),
        portfolioUrl: String(form.get("portfolioUrl") ?? ""),
        voiceNotes: String(form.get("voiceNotes") ?? ""),
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }
      setErrors({});
      toast.success("Saved.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Headline" htmlFor="headline" error={errors.headline}>
          <Input
            id="headline"
            name="headline"
            defaultValue={initial.headline}
            maxLength={120}
            placeholder="Senior Backend Engineer"
          />
        </Field>
        <Field label="Phone" htmlFor="phone" error={errors.phone}>
          <Input id="phone" name="phone" defaultValue={initial.phone} maxLength={40} />
        </Field>
        <Field label="LinkedIn" htmlFor="linkedinUrl" error={errors.linkedinUrl}>
          <Input
            id="linkedinUrl"
            name="linkedinUrl"
            defaultValue={initial.linkedinUrl}
            placeholder="https://www.linkedin.com/in/…"
          />
        </Field>
        <Field label="GitHub" htmlFor="githubUrl" error={errors.githubUrl}>
          <Input
            id="githubUrl"
            name="githubUrl"
            defaultValue={initial.githubUrl}
            placeholder="https://github.com/…"
          />
        </Field>
        <Field label="Portfolio" htmlFor="portfolioUrl" error={errors.portfolioUrl}>
          <Input
            id="portfolioUrl"
            name="portfolioUrl"
            defaultValue={initial.portfolioUrl}
            placeholder="https://…"
          />
        </Field>
      </div>
      <Field
        label="Your voice"
        htmlFor="voiceNotes"
        hint="Anything Claude should know when writing cover letters and answers for you: motivations, strengths, tone, notice period, relocation plans…"
        error={errors.voiceNotes}
      >
        <Textarea
          id="voiceNotes"
          name="voiceNotes"
          rows={5}
          defaultValue={initial.voiceNotes}
          maxLength={4000}
        />
      </Field>
      <Button type="submit" loading={pending}>
        Save
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    setPending(true);
    setError(null);
    const { error: changeError } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword") ?? ""),
      newPassword,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (changeError) {
      setError("Your current password is incorrect.");
      return;
    }
    formElement.reset();
    toast.success("Password updated. Other devices were signed out.");
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <Field label="Current password" htmlFor="currentPassword">
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="New password" htmlFor="newPassword" hint="At least 10 characters.">
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
        />
      </Field>
      {error ? (
        <div className="sm:col-span-2">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" loading={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function DangerZone() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <p className="font-medium">Delete account</p>
        <p className="text-muted-foreground">
          Permanently deletes your resumes, applications and history.
        </p>
      </div>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        description="This can't be undone."
      >
        <div className="space-y-3">
          <Field label='Type "DELETE" to confirm' htmlFor="confirm-delete">
            <Input
              id="confirm-delete"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </Field>
          {error ? <Alert>{error}</Alert> : null}
          <Button
            variant="danger"
            disabled={confirmation !== "DELETE"}
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteAccount({ confirmation });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                await authClient.signOut().catch(() => undefined);
                router.replace("/");
                router.refresh();
              })
            }
          >
            Permanently delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
