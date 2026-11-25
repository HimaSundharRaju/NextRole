import { ExternalServiceError } from "@gettargetrole/core/errors";
import type { StudioEvent } from "./types";

/**
 * The model's API is down, limiting us, or doesn't accept our key or the model: auto mode tries
 * another model and rests this one for a minute.
 */
export class ModelUnavailableError extends ExternalServiceError {}

/** The Studio event for a failed turn, saying whether the model's API was to blame. */
export function studioError(error: Error): StudioEvent {
  return {
    type: "error",
    message: error.message,
    ...(error instanceof ModelUnavailableError ? { unavailable: true } : {}),
  };
}
