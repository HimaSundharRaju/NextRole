import { describe, expect, it } from "vitest";
import { allowancesFor, limitMessage, PLANS, usageResetLabel } from "./plans";
import { safeNextPath } from "./safe-redirect";
import { formatSalary, initials, timeAgo } from "./utils";
import { aboutSchema, preferencesSchema, splitList } from "./validation";

describe("safeNextPath", () => {
  it.each([
    ["/jobs?q=go", "/jobs?q=go"],
    ["/resumes/123", "/resumes/123"],
  ])("allows same-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "",
    undefined,
  ])("rejects open-redirect target %s", (input) => {
    expect(safeNextPath(input)).toBe("/dashboard");
  });

  it("uses the first value of repeated params", () => {
    expect(safeNextPath(["/jobs", "//evil"])).toBe("/jobs");
  });
});

describe("validation", () => {
  const valid = {
    targetTitles: ["Backend Engineer"],
    targetLocations: ["San Francisco"],
    remotePreference: "any" as const,
    seniority: null,
    minSalary: 150000,
    salaryCurrency: "usd",
    workAuthorization: "US citizen",
    needsSponsorship: false,
    alertsEnabled: true,
    alertMinScore: 70,
  };

  it("accepts and normalizes preferences", () => {
    expect(preferencesSchema.parse(valid).salaryCurrency).toBe("USD");
  });

  it("rejects out-of-range values", () => {
    expect(preferencesSchema.safeParse({ ...valid, alertMinScore: 5 }).success).toBe(false);
    expect(preferencesSchema.safeParse({ ...valid, remotePreference: "mars" }).success).toBe(false);
  });

  it("only accepts https profile links", () => {
    const base = { headline: "", phone: "", githubUrl: "", portfolioUrl: "", voiceNotes: "" };
    expect(
      aboutSchema.safeParse({ ...base, linkedinUrl: "https://www.linkedin.com/in/me" }).success,
    ).toBe(true);
    expect(aboutSchema.safeParse({ ...base, linkedinUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(aboutSchema.safeParse({ ...base, linkedinUrl: "http://example.com" }).success).toBe(
      false,
    );
  });

  it("splits comma and newline lists", () => {
    expect(splitList("Backend Engineer, SRE;\nPlatform ,")).toEqual([
      "Backend Engineer",
      "SRE",
      "Platform",
    ]);
  });
});

describe("formatting", () => {
  it("formats salary ranges compactly", () => {
    expect(formatSalary(150000, 190000, "USD", "year")).toBe("$150K – $190K");
    expect(formatSalary(45, 60, "USD", "hour")).toBe("$45 – $60/hr");
    expect(formatSalary(null, null, null, null)).toBeNull();
  });

  it("formats relative times", () => {
    const now = new Date("2026-09-25T12:00:00Z");
    expect(timeAgo(new Date("2026-09-25T11:00:00Z"), now)).toBe("1 hour ago");
    expect(timeAgo(new Date("2026-09-25T11:59:50Z"), now)).toBe("just now");
  });

  it("builds initials", () => {
    expect(initials("Asha Verma")).toBe("AV");
    expect(initials("")).toBe("?");
  });
});

describe("plans", () => {
  const none = {
    import: 0,
    tailor: 0,
    letter: 0,
    answers: 0,
    outreach: 0,
    fit: 0,
    interview: 0,
    studio: 0,
    auto: 0,
  };

  it("counts what's left of each allowance and why an action is blocked", () => {
    const allowances = allowancesFor("plus", { ...none, tailor: 12, letter: 40, studio: 150 });
    expect(allowances.tailor).toEqual({ used: 12, limit: 40, left: 28, blocked: null });
    expect(allowances.letter.left).toBe(0);
    expect(allowances.letter.blocked).toBe(
      "You've used all 40 cover letters in your plan this month. Pro includes 100 a month.",
    );
    // Usage above the limit (a plan change mid-month) never shows as negative.
    expect(allowances.studio).toMatchObject({ used: 100, left: 0 });
    expect(allowances.auto.blocked).toBe(
      "Auto-prepared applications aren't included in the Plus plan. Pro includes 90 a month.",
    );
  });

  it("offers no upgrade from the top plan", () => {
    expect(limitMessage("concierge", "tailor")).toBe(
      "You've used all 600 tailored resumes in your plan this month.",
    );
  });

  it("names the reset date as the first of next month in UTC", () => {
    expect(usageResetLabel(new Date("2026-09-26T12:00:00Z"))).toBe("Oct 1");
    expect(usageResetLabel(new Date("2026-12-31T23:59:59Z"))).toBe("Jan 1");
  });

  it("lists plans cheapest first with the new Plus tier", () => {
    expect(Object.values(PLANS).map((plan) => [plan.name, plan.priceUsd])).toEqual([
      ["Free", 0],
      ["Plus", 12],
      ["Pro", 29],
      ["Concierge", 299],
    ]);
  });
});
