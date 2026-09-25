import { Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { listOutreach } from "@/server/data/outreach";
import { requireOnboardedUser } from "@/server/session";
import { OutreachCard } from "./outreach-card";

export const metadata: Metadata = { title: "Outreach" };

export default async function OutreachPage() {
  const user = await requireOnboardedUser();
  const rows = await listOutreach(user.id);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Outreach"
        description="Messages to recruiters and hiring managers. They send from your own inbox, so replies come straight to you."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Send}
          title="No drafts yet"
          description="Open any job and use “Reach the hiring team” in its apply kit to draft an email, a LinkedIn note and a follow-up."
          action={
            <Link href="/jobs" className={buttonVariants({ variant: "secondary" })}>
              Browse jobs
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map(({ message, companyName, jobTitle }) => (
            <OutreachCard
              key={message.id}
              item={{
                id: message.id,
                channel: message.channel,
                subject: message.subject,
                body: message.body,
                recipientName: message.recipientName,
                recipientEmail: message.recipientEmail,
                status: message.status,
                sentAt: message.sentAt?.toISOString() ?? null,
                context: companyName ? `${jobTitle} at ${companyName}` : "General",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
