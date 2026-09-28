import { describe, expect, it } from "vitest";
import { analyzeResume, fixAllRequest, isQuantified, type AtsIssue } from "./ats";
import { renderResumeDocx } from "./docx";
import { SAMPLE_JOB_DESCRIPTION, SAMPLE_RESUME } from "./fixtures";
import { pdfSafeText, renderResumePdf } from "./pdf";
import {
  DEFAULT_RESUME_SETTINGS,
  emptyResume,
  normalizeResume,
  resumeSchema,
  resumeSettingsSchema,
} from "./schema";
import { findSkills, skillLabel } from "./skills";
import { resumeToPlainText } from "./text";

describe("resume schema", () => {
  it("accepts the sample resume", () => {
    expect(resumeSchema.parse(SAMPLE_RESUME)).toEqual(SAMPLE_RESUME);
  });

  it("normalizes whitespace, empty entries and duplicate skills", () => {
    const messy = emptyResume();
    messy.basics.name = "  Asha   Verma ";
    messy.skills = [
      { name: "Languages", items: ["Python", "python", " ", "Go"] },
      { name: "Empty", items: [] },
    ];
    messy.experience = [
      { company: "", title: "", location: "", startDate: "", endDate: "", highlights: [] },
      {
        company: "Acme",
        title: "Engineer",
        location: "",
        startDate: "2020",
        endDate: "",
        highlights: ["  Built it ", ""],
      },
    ];
    const clean = normalizeResume(messy);
    expect(clean.basics.name).toBe("Asha Verma");
    expect(clean.skills).toEqual([{ name: "Languages", items: ["Python", "Go"] }]);
    expect(clean.experience).toHaveLength(1);
    expect(clean.experience[0]?.highlights).toEqual(["Built it"]);
  });

  it("decodes HTML entities a model wrote into plain text", () => {
    const resume = emptyResume();
    resume.basics.headline = "Senior Engineer, Golang &amp; APIs";
    resume.summary = "Builds &quot;boring&quot; payment systems &lt;fast&gt;.";
    resume.skills = [{ name: "Data &amp; ML", items: ["R&amp;D", "Python"] }];
    const clean = normalizeResume(resume);
    expect(clean.basics.headline).toBe("Senior Engineer, Golang & APIs");
    expect(clean.summary).toBe('Builds "boring" payment systems <fast>.');
    expect(clean.skills).toEqual([{ name: "Data & ML", items: ["R&D", "Python"] }]);
  });

  it("fills in default settings", () => {
    expect(resumeSettingsSchema.parse({})).toEqual(DEFAULT_RESUME_SETTINGS);
    expect(DEFAULT_RESUME_SETTINGS.template).toBe("modern");
  });
});

describe("skill matching", () => {
  it("finds canonical skills through aliases", () => {
    expect(findSkills("We use k8s, golang and Postgres")).toEqual(
      expect.arrayContaining(["kubernetes", "go", "postgresql"]),
    );
  });

  it("avoids common false positives", () => {
    const prose =
      "You will excel at working with the rest of the team this spring, and help our shell company grow.";
    const found = findSkills(prose);
    expect(found).not.toContain("excel");
    expect(found).not.toContain("rest apis");
    expect(found).not.toContain("spring boot");
    expect(found).not.toContain("bash");
  });

  it("recognizes short language names only in programming context", () => {
    expect(findSkills("Languages: Python, Go, TypeScript")).toContain("go");
    expect(findSkills("Built services in Go")).toContain("go");
    expect(findSkills("Skills: C, C++, R, SQL")).toEqual(expect.arrayContaining(["c", "r"]));
    const prose = "Ready to go to market after our Series C with R&D support. Let's go!";
    expect(findSkills(prose)).not.toEqual(expect.arrayContaining(["go"]));
    expect(findSkills(prose)).not.toContain("c");
    expect(findSkills(prose)).not.toContain("r");
  });

  it("distinguishes Java from JavaScript and SQL from PostgreSQL", () => {
    expect(findSkills("JavaScript developer")).not.toContain("java");
    expect(findSkills("PostgreSQL expert")).not.toContain("sql");
    expect(findSkills("Strong C++ and C# skills")).toEqual(expect.arrayContaining(["c++", "c#"]));
  });
});

describe("analyzeResume", () => {
  it("scores a strong resume highly and flags weak bullets", () => {
    const report = analyzeResume(SAMPLE_RESUME);
    expect(report.score).toBeGreaterThanOrEqual(80);
    expect(report.issues.some((issue) => issue.message.includes("Responsible for"))).toBe(true);
    expect(report.stats.bulletCount).toBe(8);
  });

  it("reports keyword coverage against a job description", () => {
    const report = analyzeResume(SAMPLE_RESUME, SAMPLE_JOB_DESCRIPTION);
    expect(report.keywordCoverage).not.toBeNull();
    expect(report.matchedKeywords).toEqual(expect.arrayContaining(["go", "kubernetes", "aws"]));
    expect(report.missingKeywords).toEqual(expect.arrayContaining(["grpc", "prometheus"]));
  });

  it("flags an empty resume", () => {
    const report = analyzeResume(emptyResume());
    expect(report.score).toBeLessThan(40);
    expect(report.issues[0]?.severity).toBe("high");
  });

  it("detects quantified bullets", () => {
    expect(isQuantified("Cut costs by 32%")).toBe(true);
    expect(isQuantified("Improved the onboarding flow")).toBe(false);
  });
});

describe("ATS fixes", () => {
  const fixFor = (issues: AtsIssue[], text: string) =>
    issues.find((issue) => issue.message.includes(text))?.fix;

  it("leaves facts only the person has to the editor, never the AI", () => {
    const { issues } = analyzeResume(emptyResume());
    for (const text of ["full name", "email address", "phone number", "LinkedIn", "education"]) {
      expect(fixFor(issues, text)?.kind).toBe("edit");
    }
    expect(fixFor(issues, "work experience")).toEqual({ kind: "edit", section: "experience" });
    expect(issues.every((issue) => issue.fix)).toBe(true);
  });

  it("asks the AI to rewrite a weak bullet, quoting it and keeping its facts", () => {
    const { issues } = analyzeResume(SAMPLE_RESUME);
    const fix = fixFor(issues, "Responsible for");
    expect(fix).toMatchObject({ kind: "ai" });
    expect(fix?.kind === "ai" && fix.ask).toBeFalsy();
    expect(fix?.kind === "ai" && fix.request).toMatch(
      /^Rewrite this bullet under .+ to start with a strong action verb, keeping every fact: "Responsible for/,
    );
  });

  it("has the AI ask for facts before adding keywords, numbers or bullets", () => {
    const { issues } = analyzeResume(SAMPLE_RESUME, SAMPLE_JOB_DESCRIPTION);
    const keywords = issues.find((issue) => issue.section === "Keywords")?.fix;
    expect(keywords).toMatchObject({ kind: "ai", ask: true });
    expect(keywords?.kind === "ai" && keywords.request).toContain("gRPC");
    expect(keywords?.kind === "ai" && keywords.request).toContain(
      "Ask me which of these I've actually used",
    );

    const resume = normalizeResume({
      ...SAMPLE_RESUME,
      experience: [{ ...SAMPLE_RESUME.experience[0]!, highlights: [] }],
    });
    const bullets = fixFor(analyzeResume(resume).issues, "achievement bullets");
    expect(bullets).toMatchObject({ kind: "ai", ask: true });
  });

  it("bundles the fixes the AI can make alone into one message", () => {
    const issues: AtsIssue[] = [
      {
        severity: "high",
        section: "Contact",
        message: "",
        fix: { kind: "edit", section: "basics" },
      },
      {
        severity: "medium",
        section: "Summary",
        message: "",
        fix: { kind: "ai", request: "Write a summary." },
      },
      {
        severity: "medium",
        section: "Keywords",
        message: "",
        fix: { kind: "ai", request: "Ask me.", ask: true },
      },
      {
        severity: "low",
        section: "Skills",
        message: "",
        fix: { kind: "ai", request: "Trim my skills." },
      },
      {
        severity: "low",
        section: "Skills",
        message: "",
        fix: { kind: "ai", request: "Trim my skills." },
      },
    ];
    expect(fixAllRequest(issues)).toBe(
      "Fix these issues from the ATS check, using only facts already in my resume:\n- Write a summary.\n- Trim my skills.",
    );
    // One fix is its own button.
    expect(fixAllRequest(issues.slice(0, 3))).toBeNull();

    const many = Array.from({ length: 40 }, (_, i) => ({
      ...issues[1]!,
      fix: { kind: "ai" as const, request: `Rewrite bullet ${i}: ${"x".repeat(150)}` },
    }));
    expect(fixAllRequest(many)!.length).toBeLessThanOrEqual(3_500);
  });
});

describe("renderers", () => {
  it("renders a PDF", async () => {
    const pdf = await renderResumePdf(SAMPLE_RESUME);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("renders every template and paper size", async () => {
    for (const template of ["modern", "classic", "compact"] as const) {
      const pdf = await renderResumePdf(SAMPLE_RESUME, {
        ...DEFAULT_RESUME_SETTINGS,
        template,
        paperSize: "A4",
      });
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("does not crash on characters outside the PDF base fonts", async () => {
    const resume = structuredClone(SAMPLE_RESUME);
    resume.summary = "Saved ₹40 lakh → 3× faster ✓ రాజు";
    expect(pdfSafeText("₹10 → 20")).toBe("INR 10 -> 20");
    const pdf = await renderResumePdf(resume);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a DOCX", async () => {
    const docx = await renderResumeDocx(SAMPLE_RESUME);
    expect(docx.subarray(0, 2).toString()).toBe("PK");
  });

  it("produces plain text containing every section", () => {
    const text = resumeToPlainText(SAMPLE_RESUME);
    for (const heading of [
      "SUMMARY",
      "EXPERIENCE",
      "PROJECTS",
      "SKILLS",
      "EDUCATION",
      "CERTIFICATIONS",
    ]) {
      expect(text).toContain(heading);
    }
  });
});

describe("skillLabel", () => {
  it("uses conventional spellings", () => {
    expect(skillLabel("postgresql")).toBe("PostgreSQL");
    expect(skillLabel("ci/cd")).toBe("CI/CD");
    expect(skillLabel("kubernetes")).toBe("Kubernetes");
    expect(skillLabel("event-driven architecture")).toBe("Event-driven architecture");
  });
});
