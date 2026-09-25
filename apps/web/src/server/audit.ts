import "server-only";
import { createLogger } from "@nextrole/core/logger";
import { auditLogs, getDb } from "@nextrole/db";
import { headers } from "next/headers";

const log = createLogger("audit");

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

async function requestMeta(): Promise<{ ipAddress: string; userAgent: string }> {
  try {
    const h = await headers();
    return {
      ipAddress: (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "",
      userAgent: (h.get("user-agent") ?? "").slice(0, 300),
    };
  } catch {
    // Outside a request scope (e.g. auth hooks invoked from background work).
    return { ipAddress: "", userAgent: "" };
  }
}

/** Append-only security trail. Failures are logged, never surfaced to the user. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const meta =
      entry.ipAddress || entry.userAgent
        ? { ipAddress: entry.ipAddress ?? "", userAgent: entry.userAgent ?? "" }
        : await requestMeta();
    await getDb()
      .insert(auditLogs)
      .values({
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType ?? "",
        targetId: entry.targetId ?? "",
        metadata: entry.metadata ?? {},
        ...meta,
      });
  } catch (error) {
    log.error({ err: error, action: entry.action }, "failed to write audit log");
  }
}
