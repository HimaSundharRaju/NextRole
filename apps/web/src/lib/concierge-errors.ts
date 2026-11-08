import { ConflictError, NotFoundError, ValidationError } from "@gettargetrole/core/errors";
import { ConciergeError } from "@gettargetrole/db";

/** Maps a Concierge rule break to the app error whose message is shown to the person. */
export function toAppError(error: unknown): unknown {
  if (!(error instanceof ConciergeError)) return error;
  switch (error.code) {
    case "conflict":
      return new ConflictError(error.message);
    case "not_found":
      return new NotFoundError("Application");
    default:
      return new ValidationError(error.message);
  }
}

/** Runs a Concierge operation, turning its rule breaks into readable errors. */
export async function withConcierge<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toAppError(error);
  }
}
