import { getServerEnv } from "@gettargetrole/core/env";
import { ForbiddenError } from "@gettargetrole/core/errors";
import { enforceRateLimit } from "@gettargetrole/core/rate-limit";
import { getDb, redeemExportLink } from "@gettargetrole/db";
import { clientIp } from "@/lib/client-ip";
import { recordAudit } from "@/server/audit";
import { exportUserData } from "@/server/data/account";
import { errorResponse, isSameOrigin, jsonDownload } from "@/server/http";

/**
 * Downloads an account's data with the single-use link customer care emailed: no sign-in needed.
 * The link's page only shows a button; this POST is what uses the link up, so a mail scanner that
 * opens the link can't waste it.
 */
export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      throw new ForbiddenError("Open the link from your email and try again.");
    }
    await enforceRateLimit(
      "export",
      `ip:${clientIp(request.headers, getServerEnv().TRUSTED_PROXIES)}`,
    );
    const key = String((await request.formData()).get("key") ?? "");
    const userId = key ? await redeemExportLink(getDb(), key) : null;
    if (!userId) {
      throw new ForbiddenError(
        "This link has expired or was already used. Contact support for a new one.",
      );
    }
    const data = await exportUserData(userId);
    await recordAudit({
      actorUserId: userId,
      action: "account.export",
      targetType: "user",
      targetId: userId,
      metadata: { via: "link" },
    });
    return jsonDownload(data, "gettargetrole-data");
  } catch (error) {
    return errorResponse(error);
  }
}
