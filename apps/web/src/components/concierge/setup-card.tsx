import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/misc";

export function ConciergeSetupCard({
  specialist,
  jobSearchEmail,
  consentAt,
  accessConfirmedAt,
}: {
  specialist: { name: string; email: string } | null;
  jobSearchEmail: string;
  consentAt: Date | null;
  accessConfirmedAt: Date | null;
}) {
  if (consentAt && accessConfirmedAt) return null;
  return (
    <Card>
      <CardHeader
        title="Set up your job-search inbox"
        description="So your specialist can create employer accounts and apply for you."
      />
      <CardBody className="space-y-2 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Create a new Gmail used only for job applications.</li>
          <li>
            In that Gmail, open Settings → Accounts → &ldquo;Grant access to your account&rdquo; and
            add <strong>{specialist?.email ?? "your specialist"}</strong>.
          </li>
          <li>
            Enter the address and give consent in{" "}
            <Link href="/settings#concierge" className="text-primary">
              Settings
            </Link>
            .
          </li>
        </ol>
        <p className="text-muted-foreground">
          {jobSearchEmail
            ? accessConfirmedAt
              ? "All set."
              : `Waiting for ${specialist?.name ?? "your specialist"} to confirm access to ${jobSearchEmail}.`
            : "Not started yet."}
        </p>
      </CardBody>
    </Card>
  );
}

export function ConciergeWeekCard({
  specialistName,
  applied,
  target,
  paused,
}: {
  specialistName: string;
  applied: number;
  target: number;
  paused: boolean;
}) {
  return (
    <Card>
      <CardHeader title="This week" />
      <CardBody className="space-y-2 text-sm">
        {paused ? (
          <p>Your search is paused. Resume it in Settings when you&apos;re ready.</p>
        ) : (
          <>
            <p>
              {specialistName} applied to {applied} of your {target} this week.
            </p>
            <ProgressBar value={Math.min(100, Math.round((applied / Math.max(target, 1)) * 100))} />
          </>
        )}
      </CardBody>
    </Card>
  );
}
