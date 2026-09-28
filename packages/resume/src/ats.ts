import { findSkills, skillLabel } from "./skills";
import type { Resume } from "./schema";
import { countWords, resumeToPlainText } from "./text";

export type AtsSeverity = "high" | "medium" | "low";

/** Resume sections the person fills in themselves, in the editor. */
export type AtsEditSection = "basics" | "experience" | "education";

/**
 * How to fix an issue. `ai`: a request the Studio AI carries out from what the resume already
 * says, or, with `ask`, after asking the person for the facts (so "fix all" leaves it out).
 * `edit`: facts only the person has, such as contact details, titles and dates, which the AI
 * must never make up.
 */
export type AtsFix =
  | { kind: "ai"; request: string; ask?: boolean }
  | { kind: "edit"; section: AtsEditSection };

export interface AtsIssue {
  severity: AtsSeverity;
  section: string;
  message: string;
  fix: AtsFix;
}

export interface AtsReport {
  /** 0-100 overall score. With a job description, half of it is keyword coverage. */
  score: number;
  structureScore: number;
  keywordCoverage: number | null;
  matchedKeywords: string[];
  missingKeywords: string[];
  issues: AtsIssue[];
  stats: {
    wordCount: number;
    bulletCount: number;
    quantifiedBullets: number;
    estimatedPages: number;
  };
}

const SEVERITY_COST: Record<AtsSeverity, number> = { high: 14, medium: 6, low: 2 };

const WEAK_OPENERS = [
  /^responsible for\b/i,
  /^worked on\b/i,
  /^helped\b/i,
  /^assisted\b/i,
  /^duties included\b/i,
  /^tasked with\b/i,
  /^involved in\b/i,
  /^participated in\b/i,
];

const QUANTIFIED = /(\d|%|\$|€|£|₹|\bmillion\b|\bbillion\b|\bthousand\b|\bdoubled\b|\btripled\b)/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isQuantified(bullet: string): boolean {
  return QUANTIFIED.test(bullet);
}

const ai = (request: string): AtsFix => ({ kind: "ai", request });
const ask = (request: string): AtsFix => ({ kind: "ai", request, ask: true });
const edit = (section: AtsEditSection): AtsFix => ({ kind: "edit", section });

/** A bullet quoted in a request, cut short if it's very long. */
const quoted = (bullet: string) => `"${bullet.length > 300 ? `${bullet.slice(0, 300)}…` : bullet}"`;

export function analyzeResume(resume: Resume, jobDescription?: string): AtsReport {
  const issues: AtsIssue[] = [];
  const add = (severity: AtsSeverity, section: string, message: string, fix: AtsFix) =>
    issues.push({ severity, section, message, fix });

  const { basics } = resume;
  if (!basics.name) add("high", "Contact", "Add your full name at the top.", edit("basics"));
  if (!basics.email) {
    add("high", "Contact", "Add an email address so recruiters can reach you.", edit("basics"));
  } else if (!EMAIL.test(basics.email)) {
    add("high", "Contact", "Your email address looks invalid.", edit("basics"));
  }
  if (!basics.phone) add("medium", "Contact", "Add a phone number.", edit("basics"));
  if (!basics.location) {
    add("low", "Contact", "Add your city and region; many ATS filter by location.", edit("basics"));
  }
  if (!basics.links.some((link) => /linkedin\.com/i.test(link.url))) {
    add("low", "Contact", "Add your LinkedIn profile URL.", edit("basics"));
  }

  const summaryWords = countWords(resume.summary);
  if (summaryWords === 0) {
    add(
      "medium",
      "Summary",
      "Add a 2–4 sentence summary tailored to the role.",
      ai(
        "Write a 2–4 sentence summary for the top of my resume from my experience and skills, using only facts already in it.",
      ),
    );
  } else if (summaryWords > 90) {
    add(
      "low",
      "Summary",
      "Shorten your summary to under 90 words.",
      ai("Shorten my summary to under 90 words, keeping its strongest facts."),
    );
  }

  if (resume.experience.length === 0 && resume.projects.length === 0) {
    add(
      "high",
      "Experience",
      "Add work experience or projects that show what you've built.",
      edit("experience"),
    );
  }

  let bulletCount = 0;
  let quantifiedBullets = 0;
  resume.experience.forEach((job) => {
    const label = job.company || job.title || "a role";
    if (!job.title) add("high", "Experience", `Add a job title for ${label}.`, edit("experience"));
    if (!job.startDate) add("medium", "Experience", `Add dates for ${label}.`, edit("experience"));
    if (job.highlights.length === 0) {
      add(
        "high",
        "Experience",
        `Add 3–5 achievement bullets for ${label}.`,
        ask(
          `Help me write 3–5 achievement bullets for my role at ${label}: ask me what I did there and what came of it, then add them.`,
        ),
      );
    } else if (job.highlights.length > 8) {
      add(
        "low",
        "Experience",
        `Trim ${label} to the 6–8 strongest bullets.`,
        ai(`Trim the bullets under ${label} to the 6–8 strongest, keeping every number.`),
      );
    }
    for (const bullet of job.highlights) {
      bulletCount++;
      if (isQuantified(bullet)) quantifiedBullets++;
      const words = countWords(bullet);
      if (words > 45) {
        add(
          "low",
          "Experience",
          `A bullet under ${label} is long (${words} words).`,
          ai(
            `Shorten this bullet under ${label} to under 30 words, keeping its facts and numbers: ${quoted(bullet)}`,
          ),
        );
      }
      if (WEAK_OPENERS.some((pattern) => pattern.test(bullet))) {
        add(
          "medium",
          "Experience",
          `Start "${bullet.slice(0, 40)}…" with a strong action verb (Led, Built, Reduced…).`,
          ai(
            `Rewrite this bullet under ${label} to start with a strong action verb, keeping every fact: ${quoted(bullet)}`,
          ),
        );
      }
    }
  });
  for (const project of resume.projects) {
    bulletCount += project.highlights.length;
    quantifiedBullets += project.highlights.filter(isQuantified).length;
  }

  if (bulletCount >= 4 && quantifiedBullets / bulletCount < 0.4) {
    add(
      "medium",
      "Experience",
      `Only ${quantifiedBullets} of ${bulletCount} bullets include numbers. Quantify impact (%, $, time saved, scale).`,
      ask(
        "Point out the bullets that would be stronger with a number (%, $, time saved or scale) and ask me for the figures. Don't make any up.",
      ),
    );
  }

  const skillCount = resume.skills.reduce((total, group) => total + group.items.length, 0);
  if (skillCount === 0) {
    add(
      "high",
      "Skills",
      "Add a skills section; ATS keyword searches rely on it.",
      ai(
        "Add a skills section listing the tools and skills my experience and projects already mention, grouped by type.",
      ),
    );
  } else if (skillCount > 45) {
    add(
      "low",
      "Skills",
      "Your skills list is very long; keep the most relevant.",
      ai("Trim my skills list to the 25–35 most relevant, grouped by type."),
    );
  }

  if (resume.education.length === 0) {
    add("low", "Education", "Add your education.", edit("education"));
  }

  const text = resumeToPlainText(resume);
  const wordCount = countWords(text);
  const estimatedPages = Math.max(1, Math.round((wordCount / 520) * 10) / 10);
  if (wordCount > 1100) {
    add(
      "medium",
      "Length",
      "Your resume runs past two pages; tighten it.",
      ai("Tighten my resume to fit on two pages without dropping any role, date or number."),
    );
  }
  if (wordCount < 180) {
    add(
      "medium",
      "Length",
      "Your resume is very short; add more detail on impact.",
      ask(
        "My resume is short. Ask me about my work, a few questions at a time, and add what I tell you. Don't invent anything.",
      ),
    );
  }

  const structureScore = Math.max(
    0,
    100 - issues.reduce((total, issue) => total + SEVERITY_COST[issue.severity], 0),
  );

  let keywordCoverage: number | null = null;
  let matchedKeywords: string[] = [];
  let missingKeywords: string[] = [];
  if (jobDescription && jobDescription.trim()) {
    const wanted = findSkills(jobDescription);
    const have = new Set(findSkills(text));
    matchedKeywords = wanted.filter((skill) => have.has(skill));
    missingKeywords = wanted.filter((skill) => !have.has(skill));
    keywordCoverage = wanted.length ? matchedKeywords.length / wanted.length : 1;
    if (missingKeywords.length) {
      const named = missingKeywords.slice(0, 8).map(skillLabel).join(", ");
      add(
        missingKeywords.length > 5 ? "high" : "medium",
        "Keywords",
        `The job mentions ${named}${missingKeywords.length > 8 ? "…" : ""} — add the ones you genuinely have.`,
        ask(
          `The job mentions ${missingKeywords.map(skillLabel).join(", ")}. Ask me which of these I've actually used, then add those to my skills and bullets.`,
        ),
      );
    }
  }

  const score =
    keywordCoverage === null
      ? structureScore
      : Math.round(structureScore * 0.5 + keywordCoverage * 100 * 0.5);

  const order: Record<AtsSeverity, number> = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    score,
    structureScore,
    keywordCoverage,
    matchedKeywords,
    missingKeywords,
    issues,
    stats: { wordCount, bulletCount, quantifiedBullets, estimatedPages },
  };
}

/** The longest "fix all" request, well inside a Studio message's 4,000 characters. */
const MAX_FIX_ALL_CHARS = 3_500;

/**
 * One Studio message that fixes every issue the AI can fix from the resume alone. Fixes that
 * need the person's facts, and ones the person makes in the editor, are left out. Null when
 * fewer than two fixes qualify, since one is its own button.
 */
export function fixAllRequest(issues: AtsIssue[]): string | null {
  const requests = [
    ...new Set(
      issues.flatMap((issue) =>
        issue.fix.kind === "ai" && !issue.fix.ask ? [issue.fix.request] : [],
      ),
    ),
  ];
  if (requests.length < 2) return null;
  let message = "Fix these issues from the ATS check, using only facts already in my resume:";
  for (const request of requests) {
    const line = `\n- ${request}`;
    if (message.length + line.length > MAX_FIX_ALL_CHARS) break;
    message += line;
  }
  return message;
}
