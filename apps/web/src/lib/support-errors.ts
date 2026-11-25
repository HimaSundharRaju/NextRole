import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@gettargetrole/core/errors";
import { SupportError } from "@gettargetrole/db";

/** Maps a support rule break to the app error whose message is shown to the person. */
export function toSupportError(error: unknown): unknown {
  if (!(error instanceof SupportError)) return error;
  switch (error.code) {
    case "conflict":
      return new ConflictError(error.message);
    case "forbidden":
      return new ForbiddenError(error.message);
    case "not_found":
      return new NotFoundError("Request");
    default:
      return new ValidationError(error.message);
  }
}

/** Runs a support operation, turning its rule breaks into readable errors. */
export async function withSupport<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toSupportError(error);
  }
}
