import { enforceRateLimit } from "@gettargetrole/core/rate-limit";
import { recordAudit } from "@/server/audit";
import { exportUserData } from "@/server/data/account";
import { errorResponse, jsonDownload, unauthorized } from "@/server/http";
import { getCurrentUser } from "@/server/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  try {
    await enforceRateLimit("export", user.id);
    const data = await exportUserData(user.id);
    await recordAudit({
      actorUserId: user.id,
      action: "account.export",
      targetType: "user",
      targetId: user.id,
    });
    return jsonDownload(data, "gettargetrole-data");
  } catch (error) {
    return errorResponse(error);
  }
}
