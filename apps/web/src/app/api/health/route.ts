import { getRedis } from "@nextrole/core/redis";
import { getDb } from "@nextrole/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

async function check(fn: () => Promise<unknown>, timeoutMs = 2000): Promise<"ok" | "down"> {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return "ok";
  } catch {
    return "down";
  }
}

/** Liveness/readiness probe for load balancers and orchestrators. */
export async function GET() {
  const [database, redis] = await Promise.all([
    check(() => getDb().execute(sql`select 1`)),
    check(() => getRedis().ping()),
  ]);
  const healthy = database === "ok" && redis === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks: { database, redis } },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
