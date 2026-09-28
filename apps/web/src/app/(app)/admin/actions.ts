"use server";

import { ConflictError, ValidationError } from "@gettargetrole/core/errors";
import {
  ATS_PROVIDERS,
  companies,
  getDb,
  PLANS,
  ROLES,
  sessions,
  slugify,
  specialistAssignments,
  users,
} from "@gettargetrole/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authedAction } from "@/server/action";
import { recordAudit } from "@/server/audit";
import { enqueueCompanySync } from "@/server/queue";

const adminOnly = { roles: ["admin" as const] };

export const addCompany = authedAction(
  z.object({
    name: z.string().trim().min(2).max(120),
    ats: z.enum(ATS_PROVIDERS),
    boardToken: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_.-]+$/, "Use the board's identifier from its careers URL"),
    website: z.union([z.literal(""), z.url({ protocol: /^https$/ })]),
  }),
  async (input, user) => {
    const [created] = await getDb()
      .insert(companies)
      // Names without Latin letters slug to "", so fall back to the (validated) board identifier.
      .values({
        ...input,
        slug: slugify(input.name) || slugify(`${input.ats}-${input.boardToken}`),
      })
      .onConflictDoNothing()
      .returning({ id: companies.id });
    if (!created) throw new ConflictError("That company or job board is already tracked.");
    await enqueueCompanySync(created.id).catch(() => undefined);
    await recordAudit({
      actorUserId: user.id,
      action: "admin.company.add",
      targetType: "company",
      targetId: created.id,
      metadata: input,
    });
    revalidatePath("/admin");
    return null;
  },
  adminOnly,
);

export const setCompanyActive = authedAction(
  z.object({ companyId: z.uuid(), active: z.boolean() }),
  async ({ companyId, active }, user) => {
    await getDb().update(companies).set({ active }).where(eq(companies.id, companyId));
    await recordAudit({
      actorUserId: user.id,
      action: "admin.company.active",
      targetType: "company",
      targetId: companyId,
      metadata: { active },
    });
    revalidatePath("/admin");
    return null;
  },
  adminOnly,
);

export const syncCompanyNow = authedAction(
  z.object({ companyId: z.uuid() }),
  async ({ companyId }) => {
    await enqueueCompanySync(companyId);
    return null;
  },
  { ...adminOnly, rateLimit: "adminSync" },
);

export const setUserRole = authedAction(
  z.object({ userId: z.string().min(1), role: z.enum(ROLES) }),
  async ({ userId, role }, user) => {
    if (userId === user.id) throw new ValidationError("You can't change your own role.");
    await getDb().update(users).set({ role }).where(eq(users.id, userId));
    await recordAudit({
      actorUserId: user.id,
      action: "admin.user.role",
      targetType: "user",
      targetId: userId,
      metadata: { role },
    });
    revalidatePath("/admin");
    return null;
  },
  adminOnly,
);

export const setUserPlan = authedAction(
  z.object({ userId: z.string().min(1), plan: z.enum(PLANS) }),
  async ({ userId, plan }, user) => {
    await getDb().update(users).set({ plan }).where(eq(users.id, userId));
    await recordAudit({
      actorUserId: user.id,
      action: "admin.user.plan",
      targetType: "user",
      targetId: userId,
      metadata: { plan },
    });
    revalidatePath("/admin");
    return null;
  },
  adminOnly,
);

export const setUserBanned = authedAction(
  z.object({
    userId: z.string().min(1),
    banned: z.boolean(),
    reason: z.string().trim().max(300).optional(),
  }),
  async ({ userId, banned, reason }, user) => {
    if (userId === user.id) throw new ValidationError("You can't ban yourself.");
    const db = getDb();
    await db
      .update(users)
      .set({ banned, banReason: banned ? (reason ?? "Violation of terms") : null })
      .where(eq(users.id, userId));
    // Banning takes effect immediately: revoke every active session.
    if (banned) await db.delete(sessions).where(eq(sessions.userId, userId));
    await recordAudit({
      actorUserId: user.id,
      action: banned ? "admin.user.ban" : "admin.user.unban",
      targetType: "user",
      targetId: userId,
      metadata: { reason },
    });
    revalidatePath("/admin");
    return null;
  },
  adminOnly,
);

export const assignSpecialist = authedAction(
  z.object({ specialistId: z.string().min(1), clientEmail: z.email() }),
  async ({ specialistId, clientEmail }, user) => {
    const db = getDb();
    const [specialist] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, specialistId));
    if (specialist?.role !== "specialist")
      throw new ValidationError("That user isn't a specialist.");
    const [client] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, clientEmail.toLowerCase()));
    if (!client) throw new ValidationError("No user with that email.");
    await db
      .insert(specialistAssignments)
      .values({ specialistId, clientId: client.id, active: true })
      .onConflictDoUpdate({
        target: [specialistAssignments.specialistId, specialistAssignments.clientId],
        set: { active: true },
      });
    await recordAudit({
      actorUserId: user.id,
      action: "admin.specialist.assign",
      targetType: "user",
      targetId: client.id,
      metadata: { specialistId },
    });
    revalidatePath("/admin");
    return null;
  },
  adminOnly,
);

export const unassignSpecialist = authedAction(
  z.object({ specialistId: z.string().min(1), clientId: z.string().min(1) }),
  async ({ specialistId, clientId }, user) => {
    await getDb()
      .update(specialistAssignments)
      .set({ active: false })
      .where(
        and(
          eq(specialistAssignments.specialistId, specialistId),
          eq(specialistAssignments.clientId, clientId),
        ),
      );
    await recordAudit({
      actorUserId: user.id,
      action: "admin.specialist.unassign",
      targetType: "user",
      targetId: clientId,
      metadata: { specialistId },
    });
    revalidatePath("/admin");
    return null;
  },
  adminOnly,
);
