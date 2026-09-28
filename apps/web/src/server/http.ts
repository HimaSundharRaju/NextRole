import "server-only";
import { getServerEnv } from "@gettargetrole/core/env";
import { isAppError, RateLimitError } from "@gettargetrole/core/errors";
import { createLogger } from "@gettargetrole/core/logger";
import { NextResponse } from "next/server";

const log = createLogger("api");

/** JSON error response for route handlers; internal errors are never leaked. */
export function errorResponse(error: unknown): NextResponse {
  if (isAppError(error)) {
    const response = NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
    if (error instanceof RateLimitError) {
      response.headers.set("Retry-After", String(Math.ceil(error.retryAfterSeconds)));
    }
    return response;
  }
  log.error({ err: error }, "route handler failed");
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/**
 * CSRF defense for cookie-authenticated POST route handlers: the request must come from our own
 * origin. (Server Actions get the same check from Next.js; SameSite cookies are a second layer.)
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(getServerEnv().APP_URL).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto =
      request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  return allowed.has(origin);
}

export function forbiddenOrigin(): NextResponse {
  return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
}
