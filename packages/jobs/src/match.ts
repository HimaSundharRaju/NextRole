import type { RemotePreference, Seniority, WorkplaceType } from "@nextrole/db/schema";
import { annualize } from "./normalize";

/**
 * Deterministic, zero-cost fit score used to rank the job feed and trigger alerts.
 * Claude's deeper fit analysis (packages/ai) runs on demand for a single job.
 */

export interface CandidateSignals {
  skills: string[];
  targetTitles: string[];
  targetLocations: string[];
  remotePreference: RemotePreference;
  seniority: Seniority | null;
  minSalary: number | null;
}

export interface JobSignals {
  title: string;
  skills: string[];
  location: string;
  workplaceType: WorkplaceType;
  salaryMax: number | null;
  salaryPeriod: "year" | "month" | "hour" | null;
}

export interface QuickMatch {
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
}

const TITLE_NOISE = new Set([
  "senior",
  "sr",
  "junior",
  "jr",
  "lead",
  "staff",
  "principal",
  "i",
  "ii",
  "iii",
  "iv",
  "the",
  "of",
  "and",
  "for",
  "a",
  "an",
  "to",
  "in",
  "remote",
  "hybrid",
]);

const TITLE_SYNONYMS: Record<string, string> = {
  swe: "software engineer",
  sde: "software engineer",
  developer: "engineer",
  dev: "engineer",
  programmer: "engineer",
  pm: "product manager",
  ml: "machine learning",
  ai: "machine learning",
  sre: "site reliability engineer",
  frontend: "front end",
  "front-end": "front end",
  backend: "back end",
  "back-end": "back end",
  fullstack: "full stack",
  "full-stack": "full stack",
};

export function titleTokens(title: string): Set<string> {
  const expanded = title
    .toLowerCase()
    .replace(/[(),/|:–—-]/g, " ")
    .split(/\s+/)
    .map((word) => TITLE_SYNONYMS[word] ?? word)
    .join(" ");
  return new Set(
    expanded
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9+#.]/g, ""))
      .filter((word) => word && !TITLE_NOISE.has(word)),
  );
}

/** Share of the target title's words found in the job title (0-1). */
export function titleSimilarity(jobTitle: string, targetTitle: string): number {
  const job = titleTokens(jobTitle);
  const target = titleTokens(targetTitle);
  if (target.size === 0 || job.size === 0) return 0;
  let overlap = 0;
  for (const token of target) if (job.has(token)) overlap++;
  return overlap / target.size;
}

const SENIOR_TITLE = /\b(senior|sr\.?|staff|principal|lead|head|director|vp|chief)\b/i;
const JUNIOR_TITLE = /\b(junior|jr\.?|intern|internship|entry|new grad|graduate|associate)\b/i;

function seniorityPenalty(seniority: Seniority | null, jobTitle: string): number {
  if (!seniority) return 0;
  const juniorCandidate = seniority === "intern" || seniority === "entry";
  const seniorCandidate = [
    "senior",
    "staff",
    "principal",
    "manager",
    "director",
    "executive",
  ].includes(seniority);
  if (juniorCandidate && SENIOR_TITLE.test(jobTitle)) return 20;
  if (seniorCandidate && JUNIOR_TITLE.test(jobTitle)) return 15;
  return 0;
}

function locationMatches(jobLocation: string, targets: string[]): boolean {
  const normalized = jobLocation.toLowerCase();
  return targets.some((target) => {
    const city = target.toLowerCase().split(",")[0]?.trim();
    return Boolean(city) && normalized.includes(city!);
  });
}

function locationFit(
  candidate: CandidateSignals,
  job: JobSignals,
): { fit: number; reason?: string } {
  const matchesTarget = locationMatches(job.location, candidate.targetLocations);
  const isRemote = job.workplaceType === "remote";
  switch (candidate.remotePreference) {
    case "remote":
      if (isRemote) return { fit: 1, reason: "Remote role" };
      return matchesTarget ? { fit: 0.6 } : { fit: 0.1 };
    case "hybrid":
    case "onsite":
      if (matchesTarget) return { fit: 1, reason: `In ${job.location}` };
      return isRemote ? { fit: 0.7 } : { fit: candidate.targetLocations.length ? 0.2 : 0.6 };
    case "any":
    default:
      if (isRemote) return { fit: 1, reason: "Remote role" };
      if (matchesTarget) return { fit: 1, reason: `In ${job.location}` };
      return { fit: candidate.targetLocations.length ? 0.35 : 0.6 };
  }
}

export function quickMatch(candidate: CandidateSignals, job: JobSignals): QuickMatch {
  const reasons: string[] = [];
  const have = new Set(candidate.skills.map((skill) => skill.toLowerCase()));
  const matchedSkills = job.skills.filter((skill) => have.has(skill.toLowerCase()));
  const missingSkills = job.skills.filter((skill) => !have.has(skill.toLowerCase()));
  const skillFit = job.skills.length ? matchedSkills.length / job.skills.length : 0.5;
  if (matchedSkills.length) {
    reasons.push(`${matchedSkills.length}/${job.skills.length} skills match`);
  }

  const titleFit = candidate.targetTitles.length
    ? Math.max(...candidate.targetTitles.map((title) => titleSimilarity(job.title, title)))
    : 0.5;
  if (titleFit >= 0.75) reasons.push("Title matches your target role");

  const location = locationFit(candidate, job);
  if (location.reason) reasons.push(location.reason);

  let score = skillFit * 50 + titleFit * 30 + location.fit * 20;
  score -= seniorityPenalty(candidate.seniority, job.title);

  const annualMax = annualize(job.salaryMax, job.salaryPeriod);
  if (candidate.minSalary && annualMax !== null) {
    if (annualMax < candidate.minSalary) {
      score -= 15;
      reasons.push("Pays below your minimum");
    } else {
      reasons.push("Meets your salary floor");
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    matchedSkills,
    missingSkills,
    reasons,
  };
}
