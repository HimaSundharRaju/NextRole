import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScaledPreview } from "@/components/resume/scaled-preview";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { formatDate } from "@/lib/utils";
import { recordAudit } from "@/server/audit";
import { clientsOf, isAssignedSpecialist } from "@/server/data/admin";
import { listApplications } from "@/server/data/applications";
import { getProfile } from "@/server/data/profile";
import { getPrimaryResume } from "@/server/data/resumes";
import { requireRole } from "@/server/session";
import { AddForClientForm, ClientStatusSelect } from "./client-panel";

export const metadata: Metadata = { title: "Client" };

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const specialist = await requireRole("specialist", "admin");
  const { clientId } = await params;
  if (!(await isAssignedSpecialist(specialist.id, clientId))) notFound();

  const client = (await clientsOf(specialist.id)).find((item) => item.id === clientId);
  if (!client) notFound();
  const [profile, resume, applications] = await Promise.all([
    getProfile(clientId),
    getPrimaryResume(clientId),
    listApplications(clientId),
  ]);
  await recordAudit({
    actorUserId: specialist.id,
    action: "specialist.client.view",
    targetType: "user",
    targetId: clientId,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/specialist" className="text-sm text-muted-foreground hover:text-foreground">
        ← All clients
      </Link>
      <PageHeader title={client.name} description={`${client.email} · ${client.plan} plan`} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Search preferences" />
            <CardBody className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">Roles: </span>
                {profile.targetTitles.join(", ") || "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Locations: </span>
                {profile.targetLocations.join(", ") || "—"}
              </p>
              <p className="capitalize">
                <span className="normal-case text-muted-foreground">Work style: </span>
                {profile.remotePreference}
              </p>
              <p>
                <span className="text-muted-foreground">Minimum salary: </span>
                {profile.minSalary
                  ? `${profile.salaryCurrency} ${profile.minSalary.toLocaleString()}`
                  : "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Work authorization: </span>
                {profile.workAuthorization || "—"}
                {profile.needsSponsorship ? " (needs sponsorship)" : ""}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Applications"
              description="Log roles you've applied to on the client's behalf and keep statuses current."
            />
            <CardBody className="space-y-4">
              <AddForClientForm clientId={clientId} />
              <ul className="divide-y divide-border text-sm">
                {applications.map((application) => (
                  <li key={application.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{application.jobTitle}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {application.companyName}
                        {application.appliedAt
                          ? ` · applied ${formatDate(application.appliedAt)}`
                          : ""}
                      </p>
                    </div>
                    <ClientStatusSelect
                      clientId={clientId}
                      applicationId={application.id}
                      status={application.status}
                    />
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>

        <Card className="overflow-hidden lg:self-start">
          <CardHeader
            title="Main resume"
            description={resume ? resume.title : "The client hasn't added a resume yet."}
          />
          {resume ? (
            <ScaledPreview
              resume={resume.content}
              settings={resume.settings}
              className="max-h-[48rem] rounded-none"
            />
          ) : null}
        </Card>
      </div>
    </div>
  );
}
