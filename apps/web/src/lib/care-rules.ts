import type { Role } from "@gettargetrole/db/schema";

/**
 * Whether a staff member may change another person's account from the care board. Nobody acts on
 * their own account here; admins act on anyone else, and support agents only on regular users, so
 * staff accounts stay with admins.
 */
export function canActOnAccount(
  staff: { id: string; role: Role },
  target: { id: string; role: Role },
): boolean {
  if (staff.id === target.id) return false;
  if (staff.role === "admin") return true;
  return staff.role === "support" && target.role === "user";
}
