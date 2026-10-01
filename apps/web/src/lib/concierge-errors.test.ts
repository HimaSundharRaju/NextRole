import { ConflictError, ValidationError } from "@gettargetrole/core/errors";
import { ConciergeError } from "@gettargetrole/db";
import { describe, expect, it } from "vitest";
import { toAppError, withConcierge } from "./concierge-errors";

describe("toAppError", () => {
  it("turns Concierge rule breaks into messages people can read", () => {
    expect(toAppError(new ConciergeError("conflict", "This changed"))).toBeInstanceOf(
      ConflictError,
    );
    const consent = toAppError(new ConciergeError("consent_required", "No consent yet"));
    expect(consent).toBeInstanceOf(ValidationError);
    expect((consent as Error).message).toBe("No consent yet");
  });

  it("passes other errors through", async () => {
    const other = new Error("boom");
    expect(toAppError(other)).toBe(other);
    await expect(
      withConcierge(async () => {
        throw new ConciergeError("paused", "Paused");
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
