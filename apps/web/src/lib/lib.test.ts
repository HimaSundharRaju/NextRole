import { describe, expect, it } from "vitest";
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
