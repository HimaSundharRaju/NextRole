import "server-only";
import { isAppError } from "@nextrole/core/errors";
import { createLogger } from "@nextrole/core/logger";
import { enforceRateLimit, type RateLimitPolicy } from "@nextrole/core/rate-limit";
import type { Role } from "@nextrole/db";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { getCurrentUser, type SessionUser } from "./session";

const log = createLogger("action");

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

interface ActionOptions {
  rateLimit?: RateLimitPolicy;
  roles?: Role[];
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
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join(".") || "form";
          fieldErrors[key] ??= issue.message;
        }
        return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
      }
      return { ok: true, data: await handler(parsed.data, user) };
    } catch (error) {
      unstable_rethrow(error);
      if (isAppError(error)) return { ok: false, error: error.message };
      log.error({ err: error }, "server action failed");
      return { ok: false, error: "Something went wrong. Please try again." };
    }
  };
}
