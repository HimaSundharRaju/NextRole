import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import type { Database } from "../client";
import { CHANGED_MESSAGE } from "../concierge/rules";
import { companyRequests, users } from "../schema";
import { REASON_MAX, STALE_REQUEST_DAYS, SupportError } from "./rules";

const DAY_MS = 86_400_000;
const OPEN_STATUSES = ["pending", "not_found"] as const;

export interface QueuedRequest {
  id: string;
  name: string;
  url: string;
  status: "pending" | "not_found";
  requesterId: string | null;
  requesterEmail: string | null;
  note: string;
  createdAt: Date;
}

/**
 * User requests discovery couldn't resolve, oldest first: those it didn't find a board for, and
 * those still pending after 3 days. Requests from the YC import aren't anyone's to answer.
 */
export async function companyRequestQueue(
  db: Database,
  now = new Date(),
): Promise<QueuedRequest[]> {
  const staleBefore = new Date(now.getTime() - STALE_REQUEST_DAYS * DAY_MS);
  const rows = await db
    .select({
      id: companyRequests.id,
      name: companyRequests.name,
      url: companyRequests.url,
      status: companyRequests.status,
      requesterId: companyRequests.userId,
      requesterEmail: users.email,
      note: companyRequests.note,
      createdAt: companyRequests.createdAt,
    })
    .from(companyRequests)
    .leftJoin(users, eq(users.id, companyRequests.userId))
    .where(
      and(
        eq(companyRequests.source, "user"),
        or(
          eq(companyRequests.status, "not_found"),
          and(eq(companyRequests.status, "pending"), lte(companyRequests.createdAt, staleBefore)),
        ),
      ),
    )
    .orderBy(asc(companyRequests.createdAt));
  return rows.map((row) => ({
    ...row,
    status: row.status === "not_found" ? "not_found" : "pending",
  }));
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** The careers link's host without a leading "www."; empty when the link doesn't parse. */
function hostKey(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

/** The name people typed, or the careers host when they gave only a link. */
const displayName = (row: { name: string; url: string }) => row.name.trim() || hostKey(row.url);

/**
 * The company is on the board now: resolves the request and every other open user request for
 * the same company (the same name, or the same careers host). Returns each requester to tell, once.
 */
export async function resolveCompanyRequests(
  db: Database,
  input: { requestId: string; companyId: string; status: "added" | "tracked" },
): Promise<Array<{ userId: string; name: string }>> {
  return db.transaction(async (tx) => {
    const open = await tx
      .select()
      .from(companyRequests)
      .where(
        and(
          eq(companyRequests.source, "user"),
          inArray(companyRequests.status, [...OPEN_STATUSES]),
        ),
      );
    const target = open.find((row) => row.id === input.requestId);
    if (!target) {
      const [exists] = await tx
        .select({ id: companyRequests.id })
        .from(companyRequests)
        .where(eq(companyRequests.id, input.requestId))
        .limit(1);
      throw exists
        ? new SupportError("conflict", CHANGED_MESSAGE)
        : new SupportError("not_found", "Request not found.");
    }
    const targetName = nameKey(target.name);
    const targetHost = hostKey(target.url);
    const same = open.filter(
      (row) =>
        row.id === target.id ||
        (targetName !== "" && nameKey(row.name) === targetName) ||
        (targetHost !== "" && hostKey(row.url) === targetHost),
    );
    const resolved = await tx
      .update(companyRequests)
      .set({ status: input.status, companyId: input.companyId })
      .where(
        and(
          inArray(
            companyRequests.id,
            same.map((row) => row.id),
          ),
          inArray(companyRequests.status, [...OPEN_STATUSES]),
        ),
      )
      .returning({ id: companyRequests.id });
    // Someone resolved the request between our read and our write.
    if (!resolved.some((row) => row.id === target.id)) {
      throw new SupportError("conflict", CHANGED_MESSAGE);
    }
    const resolvedIds = new Set(resolved.map((row) => row.id));
    const told = new Map<string, string>();
    // The request that was answered first, so its requester hears the name they used.
    for (const row of [target, ...same]) {
      if (row.userId && resolvedIds.has(row.id) && !told.has(row.userId)) {
        told.set(row.userId, displayName(row));
      }
    }
    return [...told].map(([userId, name]) => ({ userId, name }));
  });
}

/** Closes a request that can't be added, saving the reason that goes to the requester. */
export async function declineCompanyRequest(
  db: Database,
  input: { requestId: string; reason: string },
): Promise<{ userId: string | null; name: string }> {
  const reason = input.reason.trim().slice(0, REASON_MAX);
  if (!reason) throw new SupportError("not_allowed", "Say why you can't add it.");
  const [row] = await db
    .update(companyRequests)
    .set({ status: "declined", note: reason })
    .where(
      and(
        eq(companyRequests.id, input.requestId),
        inArray(companyRequests.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({
      userId: companyRequests.userId,
      name: companyRequests.name,
      url: companyRequests.url,
    });
  if (!row) {
    const [exists] = await db
      .select({ id: companyRequests.id })
      .from(companyRequests)
      .where(eq(companyRequests.id, input.requestId))
      .limit(1);
    throw exists
      ? new SupportError("conflict", CHANGED_MESSAGE)
      : new SupportError("not_found", "Request not found.");
  }
  return { userId: row.userId, name: displayName(row) };
}
