import { describe, expect, it } from "vitest";
import { columnOf } from "./board";

describe("columnOf", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  it("places each status in its board column", () => {
    expect(columnOf("proposed", null, now)).toBe("proposed");
    expect(columnOf("approved", null, now)).toBe("approved");
    expect(columnOf("waiting_on_client", null, now)).toBe("waiting");
    expect(columnOf("applied", new Date("2026-09-29T09:00:00Z"), now)).toBe("applied_week");
    expect(columnOf("applied", new Date("2026-09-20T09:00:00Z"), now)).toBe("in_progress");
    expect(columnOf("interviewing", null, now)).toBe("in_progress");
    expect(columnOf("skipped", null, now)).toBe("closed");
    expect(columnOf("saved", null, now)).toBeNull();
  });
});
