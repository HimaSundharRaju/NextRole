import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@gettargetrole/core/errors";
import { SupportError } from "@gettargetrole/db";
import { describe, expect, it } from "vitest";
import { toSupportError, withSupport } from "./support-errors";

describe("toSupportError", () => {
  it("turns support rule breaks into readable app errors", () => {
    expect(toSupportError(new SupportError("conflict", "This changed"))).toBeInstanceOf(
      ConflictError,
    );
    const forbidden = toSupportError(new SupportError("forbidden", "Only the owner"));
    expect(forbidden).toBeInstanceOf(ForbiddenError);
    expect((forbidden as Error).message).toBe("Only the owner");
    expect((toSupportError(new SupportError("not_found", "x")) as Error).message).toBe(
      "Request not found.",
    );
    expect(toSupportError(new SupportError("not_found", "x"))).toBeInstanceOf(NotFoundError);
  });

  it("shows the message of any other rule break, and passes other errors through", async () => {
    const refused = toSupportError(new SupportError("not_allowed", "Write the reply first."));
    expect(refused).toBeInstanceOf(ValidationError);
    expect((refused as Error).message).toBe("Write the reply first.");
    const other = new Error("boom");
    expect(toSupportError(other)).toBe(other);
    await expect(
      withSupport(async () => {
        throw new SupportError("not_allowed", "Nope");
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(withSupport(async () => 42)).resolves.toBe(42);
  });
});
