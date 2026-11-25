"use client";

import type { SupportTopic } from "@gettargetrole/db/schema";
import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";
import { SUPPORT_TOPIC_LABEL } from "@/lib/support-labels";
import { submitSupportRequest } from "./actions";

const TOPICS = Object.keys(SUPPORT_TOPIC_LABEL) as SupportTopic[];

/** The Contact support form; signed-out visitors also give a name and an email. */
export function SupportForm({
  signedIn,
  followUpTo,
  initialTopic,
}: {
  signedIn: boolean;
  followUpTo?: number;
  initialTopic?: SupportTopic;
}) {
  const [pending, startTransition] = useTransition();
  const [topic, setTopic] = useState<SupportTopic>(initialTopic ?? "account");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    startTransition(async () => {
      const result = await submitSupportRequest({
        topic,
        subject: text("subject"),
        message: text("message"),
        name: text("name") || undefined,
        email: text("email") || undefined,
        website: text("website") || undefined,
        followUpTo,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      setSent(result.data.number);
    });
  }

  if (sent !== null) {
    return (
      <Card>
        <CardBody className="space-y-3">
          <Alert tone="success">
            We&apos;ve got it — request #{sent}. We usually reply within a day.
          </Alert>
          <p className="text-sm text-muted-foreground">
            {signedIn ? (
              <>
                Follow it in{" "}
                <Link href="/support/requests" className="font-medium text-primary">
                  your requests
                </Link>
                .
              </>
            ) : (
              "We've emailed you a link to follow this request and answer us."
            )}
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          {signedIn ? null : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name" htmlFor="name" error={errors.name}>
                <Input id="name" name="name" required maxLength={100} autoComplete="name" />
              </Field>
              <Field label="Your email" htmlFor="email" error={errors.email}>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="So we can reply"
                />
              </Field>
            </div>
          )}
          <Field
            label="What is it about?"
            htmlFor="topic"
            hint={
              topic === "data"
                ? "You can also export or delete your data yourself in Settings."
                : undefined
            }
          >
            <Select
              id="topic"
              name="topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value as SupportTopic)}
            >
              {TOPICS.map((value) => (
                <option key={value} value={value}>
                  {SUPPORT_TOPIC_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subject" htmlFor="subject" error={errors.subject}>
            <Input
              id="subject"
              name="subject"
              required
              maxLength={120}
              defaultValue={followUpTo ? `Follow-up to #${followUpTo}` : ""}
            />
          </Field>
          <Field label="Message" htmlFor="message" error={errors.message}>
            <Textarea id="message" name="message" required rows={6} maxLength={5000} />
          </Field>
          {/* A trap for bots: people never see or reach this field. */}
          <div className="sr-only" aria-hidden>
            <label htmlFor="website">Leave this empty</label>
            <input id="website" name="website" tabIndex={-1} autoComplete="off" />
          </div>
          {formError && Object.keys(errors).length === 0 ? <Alert>{formError}</Alert> : null}
          <Button type="submit" loading={pending}>
            Send
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
