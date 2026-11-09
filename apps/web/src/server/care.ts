import "server-only";
import { ForbiddenError, NotFoundError } from "@gettargetrole/core/errors";
import { getDb, ROLES, users, type Role } from "@gettargetrole/db";
import { eq, inArray } from "drizzle-orm";
import { canActOnAccount } from "@/lib/care-rules";
import { requireRole, type SessionUser } from "./session";

/** For care pages: support agents and admins only; anyone else gets a 404. */
export function requireCareAgent(): Promise<SessionUser> {
  return requireRole("support", "admin");
}

/**
 * Loads the account an agent wants to change and refuses what they may not: their own account,
 * and, for support agents, any staff account.
 */
export async function assertCanActOnAccount(
  staff: SessionUser,
  userId: string,
): Promise<{ id: string; role: Role; name: string; email: string; emailVerified: boolean }> {
  const [row] = await getDb()
    .select({
      id: users.id,
      role: users.role,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw new NotFoundError("Account");
  const target = {
    ...row,
    role: (ROLES as readonly string[]).includes(row.role) ? (row.role as Role) : "user",
  };
  if (target.id === staff.id) throw new ForbiddenError("You can't change your own account here.");
  if (!canActOnAccount(staff, target)) {
    throw new ForbiddenError("Staff accounts are managed by admins.");
  }
  return target;
}

/** Everyone a case can be handed to. */
export async function careAgents(): Promise<Array<{ id: string; name: string }>> {
  return getDb()
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.role, ["support", "admin"]))
    .orderBy(users.name);
}
