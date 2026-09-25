export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "CONFLICT"
  | "EXTERNAL_SERVICE"
  | "AI_REFUSED";

/** Errors whose message is safe to show to end users. Anything else is reported generically. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have access to this.") {
    super(message, "FORBIDDEN", 403);
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Resource") {
    super(`${what} not found.`, "NOT_FOUND", 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION", 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}

export class RateLimitError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      `Too many requests. Try again in ${Math.max(1, Math.ceil(retryAfterSeconds))} seconds.`,
      "RATE_LIMITED",
      429,
      { retryAfterSeconds },
    );
  }
}

export class QuotaExceededError extends AppError {
  constructor(message = "You've used all AI credits included in your plan this month.") {
    super(message, "QUOTA_EXCEEDED", 402);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message = `${service} is unavailable right now. Please retry.`) {
    super(message, "EXTERNAL_SERVICE", 502, { service });
  }
}

export class AiRefusalError extends AppError {
  constructor(
    message = "The AI declined this request. Try rephrasing it or removing unusual content.",
  ) {
    super(message, "AI_REFUSED", 422);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Message safe to show a user for any thrown value. */
export function publicMessage(error: unknown): string {
  return isAppError(error) ? error.message : "Something went wrong. Please try again.";
}
