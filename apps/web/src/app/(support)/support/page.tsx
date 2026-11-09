import { SUPPORT_TOPICS } from "@gettargetrole/db";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { getCurrentUser } from "@/server/session";
import { SupportForm } from "./support-form";

export const metadata: Metadata = { title: "Contact support" };

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ followUp?: string; topic?: string }>;
}) {
  const user = await getCurrentUser();
  const { followUp, topic } = await searchParams;
  const followUpTo = /^\d{1,9}$/.test(followUp ?? "") ? Number(followUp) : undefined;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Contact support"
        description="Tell us what's going on. We usually reply within a day."
      />
      <SupportForm
        signedIn={Boolean(user)}
        followUpTo={followUpTo}
        initialTopic={SUPPORT_TOPICS.find((item) => item === topic)}
      />
      {user ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Already asked something?{" "}
          <Link href="/support/requests" className="font-medium text-primary">
            See your requests
          </Link>
        </p>
      ) : null}
    </div>
  );
}
