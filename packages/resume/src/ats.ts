import { findSkills, skillLabel } from "./skills";
import type { Resume } from "./schema";
import { countWords, resumeToPlainText } from "./text";

export type AtsSeverity = "high" | "medium" | "low";

export interface AtsIssue {
  severity: AtsSeverity;
  section: string;
  message: string;
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

export function analyzeResume(resume: Resume, jobDescription?: string): AtsReport {
  const issues: AtsIssue[] = [];
  const add = (severity: AtsSeverity, section: string, message: string) =>
    issues.push({ severity, section, message });

  const { basics } = resume;
  if (!basics.name) add("high", "Contact", "Add your full name at the top.");
  if (!basics.email) add("high", "Contact", "Add an email address so recruiters can reach you.");
  else if (!EMAIL.test(basics.email)) add("high", "Contact", "Your email address looks invalid.");
  if (!basics.phone) add("medium", "Contact", "Add a phone number.");
  if (!basics.location)
    add("low", "Contact", "Add your city and region; many ATS filter by location.");
  if (!basics.links.some((link) => /linkedin\.com/i.test(link.url))) {
    add("low", "Contact", "Add your LinkedIn profile URL.");
  }

  const summaryWords = countWords(resume.summary);
  if (summaryWords === 0)
    add("medium", "Summary", "Add a 2–4 sentence summary tailored to the role.");
  else if (summaryWords > 90) add("low", "Summary", "Shorten your summary to under 90 words.");

  if (resume.experience.length === 0 && resume.projects.length === 0) {
    add("high", "Experience", "Add work experience or projects that show what you've built.");
  }

  let bulletCount = 0;
  let quantifiedBullets = 0;
  resume.experience.forEach((job) => {
    const label = job.company || job.title || "a role";
    if (!job.title) add("high", "Experience", `Add a job title for ${label}.`);
    if (!job.startDate) add("medium", "Experience", `Add dates for ${label}.`);
    if (job.highlights.length === 0) {
      add("high", "Experience", `Add 3–5 achievement bullets for ${label}.`);
    } else if (job.highlights.length > 8) {
      add("low", "Experience", `Trim ${label} to the 6–8 strongest bullets.`);
    }
    for (const bullet of job.highlights) {
      bulletCount++;
      if (isQuantified(bullet)) quantifiedBullets++;
      const words = countWords(bullet);
      if (words > 45) add("low", "Experience", `A bullet under ${label} is long (${words} words).`);
      if (WEAK_OPENERS.some((pattern) => pattern.test(bullet))) {
        add(
          "medium",
          "Experience",
          `Start "${bullet.slice(0, 40)}…" with a strong action verb (Led, Built, Reduced…).`,
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
    );
  }

  const skillCount = resume.skills.reduce((total, group) => total + group.items.length, 0);
  if (skillCount === 0)
    add("high", "Skills", "Add a skills section; ATS keyword searches rely on it.");
  else if (skillCount > 45)
    add("low", "Skills", "Your skills list is very long; keep the most relevant.");

  if (resume.education.length === 0) add("low", "Education", "Add your education.");

  const text = resumeToPlainText(resume);
  const wordCount = countWords(text);
  const estimatedPages = Math.max(1, Math.round((wordCount / 520) * 10) / 10);
  if (wordCount > 1100) add("medium", "Length", "Your resume runs past two pages; tighten it.");
  if (wordCount < 180)
    add("medium", "Length", "Your resume is very short; add more detail on impact.");

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
      add(
        missingKeywords.length > 5 ? "high" : "medium",
        "Keywords",
        `The job mentions ${missingKeywords.slice(0, 8).map(skillLabel).join(", ")}${missingKeywords.length > 8 ? "…" : ""} — add the ones you genuinely have.`,
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
