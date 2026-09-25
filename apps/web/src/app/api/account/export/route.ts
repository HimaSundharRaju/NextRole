import { enforceRateLimit } from "@gettargetrole/core/rate-limit";
import { recordAudit } from "@/server/audit";
import { exportUserData } from "@/server/data/account";
import { errorResponse, unauthorized } from "@/server/http";
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
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="gettargetrole-data-${new Date().toISOString().slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
