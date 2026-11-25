import { describe, expect, it } from "vitest";
import type { CaseStatus } from "../schema";
import {
  AUTO_SOLVE_DAYS,
  canMoveCase,
  EXPORT_LINK_HOURS,
  FIRST_REPLY_HOURS,
  firstReplyState,
  MESSAGE_MAX,
  normalizeEmail,
  openToRequester,
  previousWeek,
  REASON_MAX,
  REOPEN_DAYS,
  STALE_REQUEST_DAYS,
  SUBJECT_MAX,
  SupportError,
  weeklyCheckAction,
  type CaseActor,
} from "./rules";

const NOW = new Date("2026-11-10T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
type Move = [CaseStatus, CaseStatus, CaseActor, Date | null];

describe("canMoveCase", () => {
  it.each<Move>([
    ["open", "waiting_on_user", "agent", null],
    ["waiting_on_user", "open", "user", null],
    ["open", "solved", "agent", null],
    ["waiting_on_user", "solved", "system", null],
    ["solved", "open", "agent", daysAgo(30)],
    ["solved", "open", "user", daysAgo(13)],
    ["solved", "waiting_on_user", "agent", daysAgo(2)],
  ])("allows %s → %s by %s", (from, to, actor, solvedAt) => {
    expect(canMoveCase(from, to, actor, solvedAt, NOW)).toBe(true);
  });

  it.each<Move>([
    ["solved", "open", "user", daysAgo(15)],
    ["open", "solved", "user", null],
    ["open", "solved", "system", null],
    ["open", "waiting_on_user", "user", null],
    ["open", "open", "user", null],
  ])("refuses %s → %s by %s", (from, to, actor, solvedAt) => {
    expect(canMoveCase(from, to, actor, solvedAt, NOW)).toBe(false);
  });
});

describe("firstReplyState", () => {
  it("keeps the 24-hour target for help cases only", () => {
    const createdAt = new Date("2026-11-10T00:00:00Z");
    const help = {
      kind: "help" as const,
      status: "open" as const,
      createdAt,
      firstRepliedAt: null,
    };
    expect(firstReplyState(help, new Date("2026-11-10T03:00:00Z"))).toEqual({
      dueAt: new Date("2026-11-11T00:00:00Z"),
      overdue: false,
    });
    expect(firstReplyState(help, new Date("2026-11-11T01:00:00Z"))?.overdue).toBe(true);
    expect(firstReplyState({ ...help, firstRepliedAt: createdAt }, NOW)).toBeNull();
    expect(firstReplyState({ ...help, kind: "escalation" }, NOW)).toBeNull();
    expect(firstReplyState({ ...help, status: "solved" }, NOW)).toBeNull();
  });
});

describe("the weekly check", () => {
  it("decides the weekly check and finds last week", () => {
    expect(weeklyCheckAction({ applied: 9, target: 15, hasOpenEscalation: false })).toBe("open");
    expect(weeklyCheckAction({ applied: 9, target: 15, hasOpenEscalation: true })).toBe("note");
    expect(weeklyCheckAction({ applied: 15, target: 15, hasOpenEscalation: false })).toBe("skip");
    expect(weeklyCheckAction({ applied: 0, target: 0, hasOpenEscalation: false })).toBe("skip");
    const week = previousWeek(new Date("2026-11-10T08:00:00Z"));
    expect(week.start.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
});

describe("requesters", () => {
  it("normalizes emails and keeps solved cases open to the requester for 14 days", () => {
    expect(normalizeEmail("  Riya@Example.COM ")).toBe("riya@example.com");
    expect(openToRequester("solved", daysAgo(13), NOW)).toBe(true);
    expect(openToRequester("solved", daysAgo(15), NOW)).toBe(false);
    expect(openToRequester("waiting_on_user", null, NOW)).toBe(true);
  });

  it("closes exactly after 14 days, not on the 14th day itself", () => {
    expect(openToRequester("solved", daysAgo(14), NOW)).toBe(true);
    expect(openToRequester("solved", new Date(daysAgo(14).getTime() - 1), NOW)).toBe(false);
  });
});

describe("support constants and errors", () => {
  it("pins the spec's times and limits", () => {
    expect([
      FIRST_REPLY_HOURS,
      AUTO_SOLVE_DAYS,
      REOPEN_DAYS,
      STALE_REQUEST_DAYS,
      EXPORT_LINK_HOURS,
    ]).toEqual([24, 7, 14, 3, 24]);
    expect([SUBJECT_MAX, MESSAGE_MAX, REASON_MAX]).toEqual([120, 5000, 300]);
  });

  it("carries a code and a readable message", () => {
    const error = new SupportError("conflict", "This changed — refresh to see the latest.");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "SupportError",
      code: "conflict",
      message: "This changed — refresh to see the latest.",
    });
  });
});
