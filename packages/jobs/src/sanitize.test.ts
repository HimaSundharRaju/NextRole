import { describe, expect, it } from "vitest";
import { annualize, inferWorkplaceType, parseSalaryFromText } from "./normalize";
import { decodeEntities, htmlToText, sanitizeJobHtml } from "./sanitize";

describe("sanitizeJobHtml", () => {
  it.each([
    ['<p>Hi</p><script>alert("x")</script>', "<p>Hi</p>"],
    ['<img src="x" onerror="alert(1)"><p>ok</p>', "<p>ok</p>"],
    ['<p onclick="steal()">Click</p>', "<p>Click</p>"],
    ['<iframe src="https://evil.example"></iframe><p>safe</p>', "<p>safe</p>"],
    ['<p style="position:fixed">styled</p>', "<p>styled</p>"],
    ["<svg><script>alert(1)</script></svg><p>x</p>", "<p>x</p>"],
  ])("removes dangerous markup: %s", (input, expected) => {
    expect(sanitizeJobHtml(input)).toBe(expected);
  });

  it("neutralizes javascript: links and hardens real ones", () => {
    const html = sanitizeJobHtml(
      '<a href="javascript:alert(1)">bad</a> <a href="https://example.com/apply" target="_self">apply</a>',
    );
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com/apply"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it("keeps structural formatting and demotes h1", () => {
    expect(sanitizeJobHtml("<h1>Title</h1><ul><li><strong>Go</strong></li></ul>")).toBe(
      "<h2>Title</h2><ul><li><strong>Go</strong></li></ul>",
    );
  });

  it("drops empty paragraphs", () => {
    expect(sanitizeJobHtml("<p> </p><p>Text</p>")).toBe("<p>Text</p>");
  });
});

describe("text helpers", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("&lt;p&gt;R&amp;D &#8212; caf&#xe9;&nbsp;")).toBe("<p>R&D — café ");
  });

  it("converts HTML to readable text with bullets", () => {
    expect(htmlToText("<p>Intro</p><ul><li>One</li><li>Two &amp; three</li></ul>")).toBe(
      "Intro\n• One\n• Two & three",
    );
  });
});

describe("normalization", () => {
  it("infers workplace type", () => {
    expect(inferWorkplaceType(["Remote (US)"])).toBe("remote");
    expect(inferWorkplaceType(["NYC — Hybrid, 3 days in office"])).toBe("hybrid");
    expect(inferWorkplaceType(["This role is not remote"], "onsite")).toBe("onsite");
    expect(inferWorkplaceType(["Chicago, IL"])).toBe("unknown");
  });

  it.each([
    [
      "Base pay: $150,000 - $190,000 USD",
      { min: 150000, max: 190000, currency: "USD", period: "year" },
    ],
    ["$150k–$190k", { min: 150000, max: 190000, currency: "USD", period: "year" }],
    ["£60,000 to £75,000", { min: 60000, max: 75000, currency: "GBP", period: "year" }],
    ["$45 - $60 per hour", { min: 45, max: 60, currency: "USD", period: "hour" }],
    ["$8,000 - $10,000 per month", { min: 8000, max: 10000, currency: "USD", period: "month" }],
  ])("parses salary from %s", (text, expected) => {
    expect(parseSalaryFromText(text)).toEqual(expected);
  });

  it("ignores text without a salary range", () => {
    expect(parseSalaryFromText("We raised $50M in 2024")).toBeNull();
    expect(parseSalaryFromText("$200 - $100")).toBeNull();
  });

  it("annualizes pay", () => {
    expect(annualize(50, "hour")).toBe(104000);
    expect(annualize(10000, "month")).toBe(120000);
    expect(annualize(null, "year")).toBeNull();
  });
});
