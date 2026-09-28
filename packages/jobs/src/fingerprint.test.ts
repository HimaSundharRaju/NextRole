import { describe, expect, it } from "vitest";
import { jobFingerprint } from "./fingerprint";

describe("jobFingerprint", () => {
  it("normalizes case, punctuation, accents and legal suffixes", () => {
    expect(jobFingerprint("Acme, Inc.", "Senior Engineer (Payments)", "San Francisco, CA")).toBe(
      "acme|senior engineer payments|san francisco",
    );
    expect(jobFingerprint("Café Société LLC", "Chef", "Montréal, QC")).toBe(
      "cafe societe|chef|montreal",
    );
  });

  it("matches an employer's legal name to its everyday name", () => {
    const board = jobFingerprint("Amazon", "Software Development Engineer", "Seattle, WA");
    expect(
      jobFingerprint(
        "Amazon.com Services LLC",
        "Software Development Engineer",
        "Seattle, Washington",
      ),
    ).toBe(board);
    expect(jobFingerprint("JPMorgan Chase & Co.", "Analyst", "New York, NY")).toBe(
      jobFingerprint("JPMorgan Chase", "Analyst", "New York"),
    );
  });

  it("reads the city after the country and state codes some boards put first", () => {
    expect(jobFingerprint("Acme", "Engineer", "US-CA-San Francisco")).toBe(
      jobFingerprint("Acme", "Engineer", "San Francisco, CA"),
    );
  });

  it("keeps different employers, titles and places apart", () => {
    const base = jobFingerprint("Capital One", "Data Engineer", "McLean, VA");
    expect(jobFingerprint("Capital Group", "Data Engineer", "McLean, VA")).not.toBe(base);
    expect(jobFingerprint("Capital One", "Senior Data Engineer", "McLean, VA")).not.toBe(base);
    expect(jobFingerprint("Capital One", "Data Engineer", "Richmond, VA")).not.toBe(base);
  });

  it("keeps a name made only of generic words", () => {
    expect(jobFingerprint("The Company", "Engineer", "")).toBe("the company|engineer|anywhere");
  });
});
