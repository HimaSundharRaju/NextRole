"use server";

import { ForbiddenError } from "@gettargetrole/core/errors";
import { APPLICATION_STATUSES } from "@gettargetrole/db/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/server/action";
import { recordAudit } from "@/server/audit";
import { isAssignedSpecialist } from "@/server/data/admin";
import { changeStatus, createExternalApplication } from "@/server/data/applications";
import type { SessionUser } from "@/server/session";

const specialistRoles = { roles: ["specialist" as const, "admin" as const] };

/** Specialists may only act for clients actively assigned to them. */
async function assertAssigned(user: SessionUser, clientId: string): Promise<void> {
  if (!(await isAssignedSpecialist(user.id, clientId))) throw new ForbiddenError();
}

export const addClientApplication = authedAction(
  z.object({
    clientId: z.string().min(1),
    companyName: z.string().trim().min(1).max(120),
    jobTitle: z.string().trim().min(1).max(160),
    jobUrl: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]),
    location: z.string().trim().max(120),
  }),
  async ({ clientId, ...input }, user) => {
    await assertAssigned(user, clientId);
    const application = await createExternalApplication(
      clientId,
      { ...input, status: "applied", notes: "" },
      user.id,
    );
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.application.add",
      targetType: "application",
      targetId: application.id,
      metadata: { clientId },
    });
    revalidatePath(`/specialist/${clientId}`);
    return null;
  },
  specialistRoles,
);

export const moveClientApplication = authedAction(
  z.object({
    clientId: z.string().min(1),
    applicationId: z.uuid(),
    status: z.enum(APPLICATION_STATUSES),
  }),
  async ({ clientId, applicationId, status }, user) => {
    await assertAssigned(user, clientId);
    await changeStatus(clientId, applicationId, status, user.id);
    await recordAudit({
      actorUserId: user.id,
      action: "specialist.application.status",
      targetType: "application",
      targetId: applicationId,
      metadata: { clientId, status },
    });
    revalidatePath(`/specialist/${clientId}`);
    return null;
  },
  specialistRoles,
);
