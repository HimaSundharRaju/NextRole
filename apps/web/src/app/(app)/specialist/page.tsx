import { UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { clientsOf } from "@/server/data/admin";
import { requireRole } from "@/server/session";

export const metadata: Metadata = { title: "Clients" };

export default async function SpecialistPage() {
  const user = await requireRole("specialist", "admin");
  const clients = await clientsOf(user.id);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Your clients"
        description="Concierge clients assigned to you. Every action is logged to the client's timeline."
      />
      {clients.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title="No clients assigned"
          description="An admin assigns concierge clients from the Admin → Concierge tab."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/specialist/${client.id}`}
                className="block rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md"
              >
                <p className="font-medium">{client.name}</p>
                <p className="text-sm text-muted-foreground">{client.email}</p>
                <Badge tone="primary" className="mt-2 capitalize">
                  {client.plan}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
