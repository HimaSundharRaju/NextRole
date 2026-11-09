import { SUPPORT_TOPICS } from "@gettargetrole/db/schema";
import { describe, expect, it } from "vitest";
import {
  dueLabel,
  STAFF_STATUS_LABEL,
  STATUS_TONE,
  SUPPORT_TOPIC_LABEL,
  USER_STATUS_LABEL,
} from "./support-labels";

describe("dueLabel", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const at = (min: number) => new Date(now.getTime() + min * 60_000);

  it("labels due times in hours, or minutes under an hour", () => {
    expect(dueLabel({ dueAt: at(190), overdue: false }, now)).toBe("Due in 3h");
    expect(dueLabel({ dueAt: at(45), overdue: false }, now)).toBe("Due in 45m");
    expect(dueLabel({ dueAt: at(-300), overdue: true }, now)).toBe("Overdue by 5h");
    expect(dueLabel({ dueAt: at(-20), overdue: true }, now)).toBe("Overdue by 20m");
  });

  it("switches to hours at 60 minutes and never says 0 minutes", () => {
    expect(dueLabel({ dueAt: at(60), overdue: false }, now)).toBe("Due in 1h");
    expect(dueLabel({ dueAt: at(59), overdue: false }, now)).toBe("Due in 59m");
    expect(dueLabel({ dueAt: at(0.2), overdue: false }, now)).toBe("Due in 1m");
    expect(dueLabel({ dueAt: at(-0.2), overdue: true }, now)).toBe("Overdue by 1m");
  });
});

describe("labels", () => {
  it("names every topic, and says each status the way the person reading it needs", () => {
    expect(Object.keys(SUPPORT_TOPIC_LABEL).sort()).toEqual([...SUPPORT_TOPICS].sort());
    expect(SUPPORT_TOPIC_LABEL.account).toBe("Account & sign-in");
    expect(SUPPORT_TOPIC_LABEL.bug).toBe("Something's broken");
    expect(USER_STATUS_LABEL).toEqual({
      open: "With our team",
      waiting_on_user: "Waiting on you",
      solved: "Solved",
    });
    expect(STAFF_STATUS_LABEL).toEqual({
      open: "Open",
      waiting_on_user: "Waiting on user",
      solved: "Solved",
    });
  });

  it("colours a case's badge by what it needs next", () => {
    expect(STATUS_TONE).toEqual({ open: "primary", waiting_on_user: "warning", solved: "success" });
  });
});
