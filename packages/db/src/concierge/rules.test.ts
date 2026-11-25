import { describe, expect, it } from "vitest";
import type { ApplicationStatus } from "../schema";
import {
  behindPace,
  canTransition,
  mergeAnswer,
  targetFor,
  weekStart,
  type ConciergeActor,
} from "./rules";

type Move = [ApplicationStatus, ApplicationStatus, ConciergeActor];

describe("canTransition", () => {
  const allowed: Move[] = [
    ["proposed", "approved", "client"],
    ["proposed", "skipped", "client"],
    ["proposed", "skipped", "system"],
    ["proposed", "withdrawn", "staff"],
    ["approved", "waiting_on_client", "staff"],
    ["approved", "applied", "staff"],
    ["approved", "applied", "client"],
    ["waiting_on_client", "approved", "system"],
    ["waiting_on_client", "applied", "client"],
    ["waiting_on_client", "withdrawn", "staff"],
    ["saved", "approved", "client"],
    ["saved", "applied", "client"],
    ["applied", "interviewing", "staff"],
    ["interviewing", "offer", "client"],
  ];
  const refused: Move[] = [
    ["proposed", "approved", "staff"],
    ["proposed", "skipped", "staff"],
    ["proposed", "applied", "staff"],
    ["approved", "waiting_on_client", "client"],
    ["waiting_on_client", "applied", "staff"],
    ["waiting_on_client", "approved", "staff"],
    ["skipped", "approved", "client"],
    ["skipped", "withdrawn", "staff"],
    ["applied", "proposed", "staff"],
    ["saved", "approved", "staff"],
    ["approved", "approved", "client"],
    ["applied", "screening", "system"],
  ];
  it.each(allowed)("lets %s → %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
  });
  it.each(refused)("refuses %s → %s by %s", (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(false);
  });
});

describe("weekStart", () => {
  it("starts weeks on Monday at midnight UTC", () => {
    const monday = "2026-09-28T00:00:00.000Z";
    expect(weekStart(new Date("2026-10-04T23:30:00Z")).toISOString()).toBe(monday);
    expect(weekStart(new Date(monday)).toISOString()).toBe(monday);
    expect(weekStart(new Date("2026-09-30T12:00:00Z")).toISOString()).toBe(monday);
  });
});

describe("behindPace", () => {
  const wednesdayNoon = new Date("2026-09-30T12:00:00Z"); // 2.5 days into the week

  it("expects a share of the target by this point in the week", () => {
    // floor(15 × 2.5 ÷ 7) = 5
    expect(behindPace(5, 15, wednesdayNoon)).toBe(false);
    expect(behindPace(4, 15, wednesdayNoon)).toBe(true);
  });

  it("never flags a paused client or a zero target, and expects nothing on Monday morning", () => {
    expect(behindPace(0, 15, wednesdayNoon, true)).toBe(false);
    expect(behindPace(0, 0, wednesdayNoon)).toBe(false);
    expect(behindPace(0, 15, new Date("2026-09-28T00:00:00Z"))).toBe(false);
  });
});

describe("targetFor and mergeAnswer", () => {
  it("uses the default target unless overridden", () => {
    expect(targetFor(null)).toBe(15);
    expect(targetFor(8)).toBe(8);
  });

  it("replaces an answer to the same question, ignoring case and spacing", () => {
    const now = new Date("2026-09-30T12:00:00Z");
    const bank = mergeAnswer([], "Notice period?", "Two weeks", now);
    const updated = mergeAnswer(bank, "  notice PERIOD? ", "One month", now);
    expect(updated).toEqual([
      { question: "notice PERIOD?", answer: "One month", updatedAt: now.toISOString() },
    ]);
  });
});
