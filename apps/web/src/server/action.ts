import "server-only";
import { getServerEnv } from "@gettargetrole/core/env";
import { isAppError } from "@gettargetrole/core/errors";
import { createLogger } from "@gettargetrole/core/logger";
import { enforceRateLimit, type RateLimitPolicy } from "@gettargetrole/core/rate-limit";
import type { Role } from "@gettargetrole/db";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { getCurrentUser, type SessionUser } from "./session";

const log = createLogger("action");

export type ActionResult<T = null> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

interface ActionOptions {
  rateLimit?: RateLimitPolicy;
  roles?: Role[];
}

function invalidInput(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
}

/** Turns a thrown error into a result: known errors show their message, others a generic one. */
function failure(error: unknown): ActionResult<never> {
  unstable_rethrow(error);
  if (isAppError(error)) return { ok: false, error: error.message };
  log.error({ err: error }, "server action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

/**
 * Wraps a server action with the checks every mutation needs: an authenticated session,
 * optional role and rate limits, and Zod validation of untrusted input. Known application
 * errors are returned as messages; anything else is logged and reported generically.
 */
export function authedAction<S extends z.ZodType, R>(
  schema: S,
  handler: (input: z.infer<S>, user: SessionUser) => Promise<R>,
  options: ActionOptions = {},
): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (input) => {
    try {
      const user = await getCurrentUser();
      if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
      if (options.roles && !options.roles.includes(user.role)) {
        return { ok: false, error: "You don't have access to do that." };
      }
      await enforceRateLimit(options.rateLimit ?? "mutation", user.id);
      const parsed = schema.safeParse(input);
      if (!parsed.success) return invalidInput(parsed.error);
      return { ok: true, data: await handler(parsed.data, user) };
    } catch (error) {
      return failure(error);
    }
  };
}

/**
 * Like `authedAction`, for actions signed-out visitors may use (Contact support). A signed-in
 * user is limited per account, a visitor per address, each by its own policy.
 */
export function publicAction<S extends z.ZodType, R>(
  schema: S,
  handler: (input: z.infer<S>, user: SessionUser | null, ip: string) => Promise<R>,
  options: { signedIn: RateLimitPolicy; signedOut: RateLimitPolicy },
): (input: z.input<S>) => Promise<ActionResult<R>> {
  return async (input) => {
    try {
      const user = await getCurrentUser();
      const ip = clientIp(await headers(), getServerEnv().TRUSTED_PROXIES);
      await enforceRateLimit(
        user ? options.signedIn : options.signedOut,
        user ? user.id : `ip:${ip}`,
      );
      const parsed = schema.safeParse(input);
      if (!parsed.success) return invalidInput(parsed.error);
      return { ok: true, data: await handler(parsed.data, user, ip) };
    } catch (error) {
      return failure(error);
    }
  };
}
