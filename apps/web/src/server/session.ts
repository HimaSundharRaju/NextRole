import "server-only";
import type { Plan, Role } from "@gettargetrole/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: Role;
  plan: Plan;
  onboardedAt: Date | null;
}

function toSessionUser(user: Record<string, unknown>): SessionUser {
  const role = user.role === "admin" || user.role === "specialist" ? user.role : "user";
  const plan = user.plan === "pro" || user.plan === "concierge" ? user.plan : "free";
  const onboardedAt = user.onboardedAt ? new Date(user.onboardedAt as string | Date) : null;
  return {
    id: String(user.id),
    name: String(user.name ?? ""),
    email: String(user.email ?? ""),
    emailVerified: Boolean(user.emailVerified),
    role,
    plan,
    onboardedAt,
  };
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session || session.user.banned) return null;
  return toSessionUser(session.user as Record<string, unknown>);
});

/** For pages: redirects to sign-in when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireOnboardedUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.onboardedAt) redirect("/onboarding");
  return user;
}

/** Admin-only pages 404 for everyone else so their existence isn't revealed. */
export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) notFound();
  return user;
}
