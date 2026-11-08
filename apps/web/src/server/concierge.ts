import "server-only";
import { ForbiddenError, NotFoundError } from "@gettargetrole/core/errors";
import { getDb, hasActiveAssignment, PLANS, users, type Plan } from "@gettargetrole/db";
import { eq } from "drizzle-orm";
import type { SessionUser } from "./session";

/** Admins act for anyone; a specialist only for clients actively assigned to them. */
export async function canActForClient(user: SessionUser, clientId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  return user.role === "specialist" && hasActiveAssignment(getDb(), user.id, clientId);
}

export async function assertCanActForClient(user: SessionUser, clientId: string): Promise<void> {
  if (!(await canActForClient(user, clientId))) throw new ForbiddenError();
}

/** The client as a session user, so their plan's allowances apply to work done for them. */
export async function loadClientUser(clientId: string): Promise<SessionUser> {
  const [row] = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      plan: users.plan,
      onboardedAt: users.onboardedAt,
    })
    .from(users)
    .where(eq(users.id, clientId))
    .limit(1);
  if (!row) throw new NotFoundError("Client");
  return {
    ...row,
    role: "user",
    plan: PLANS.includes(row.plan as Plan) ? (row.plan as Plan) : "free",
  };
}
