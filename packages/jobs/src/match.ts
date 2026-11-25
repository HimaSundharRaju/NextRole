import type { RemotePreference, Seniority, WorkplaceType } from "@gettargetrole/db/schema";
import { annualize } from "./normalize";
import { SENIORITY_ROLE_LABEL, seniorityFromTitle } from "./seniority";

/**
 * Deterministic, zero-cost fit score used to rank the job feed and trigger alerts.
 * The AI's deeper fit analysis (packages/ai) runs on demand for a single job.
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
  /** The level and years the post asks for, when job enrichment has read them. */
  seniority?: Seniority | null;
  yearsMin?: number | null;
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

const JUNIOR_LEVELS = new Set<Seniority>(["intern", "entry"]);
const SENIOR_LEVELS = new Set<Seniority>([
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
]);

/** Points off for a mid-level candidate, by the level of the role. */
const MID_CANDIDATE_PENALTY: Record<Seniority, number> = {
  intern: 25,
  entry: 10,
  mid: 0,
  senior: 6,
  manager: 15,
  staff: 15,
  principal: 20,
  director: 20,
  executive: 20,
};

/**
 * Points off for a level mismatch. The post's level (read by enrichment), else the one its title
 * implies, else nothing: most posts have neither years nor a level, so the title does the work.
 * A junior candidate loses points for senior roles and ones asking for five or more years, a
 * mid-level candidate for roles above or far below them, and a senior one for internships and
 * entry-level roles.
 */
function seniorityPenalty(
  seniority: Seniority | null,
  job: JobSignals,
): { points: number; reason?: string } {
  if (!seniority) return { points: 0 };
  const level = job.seniority ?? seniorityFromTitle(job.title);
  const levelReason = level ? SENIORITY_ROLE_LABEL[level] : undefined;
  const years = job.yearsMin ?? 0;

  if (JUNIOR_LEVELS.has(seniority)) {
    if ((level && SENIOR_LEVELS.has(level)) || years >= 5) {
      return { points: 20, reason: years >= 5 ? `Asks for ${years}+ years` : levelReason };
    }
    return { points: 0 };
  }
  if (seniority === "mid") {
    const byLevel = level ? MID_CANDIDATE_PENALTY[level] : 0;
    const byYears = years >= 8 ? 10 : 0;
    if (byYears > byLevel) return { points: byYears, reason: `Asks for ${years}+ years` };
    return byLevel > 0 ? { points: byLevel, reason: levelReason } : { points: 0 };
  }
  // Senior and above: internships and entry-level roles are a step down.
  if (level === "intern") return { points: 25, reason: levelReason };
  if (level === "entry") return { points: 15, reason: levelReason };
  return { points: 0 };
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

/** A job that lists fewer skills than this can't earn full skill credit: too little to go on. */
const MIN_SKILLS_FOR_FULL_CREDIT = 4;
/** What a job with no skills listed is worth, and where a sparse list's credit is pulled toward. */
const NEUTRAL_SKILL_FIT = 0.5;

/**
 * The share of a job's skills the candidate has, tempered when the job lists few: one matching
 * skill out of one used to earn the full 50 points, so unrelated roles with a single extracted
 * skill (a "Physical Design Engineer" that mentions Python) scored 77%. Below four skills a
 * high share is blended toward the neutral 50% in proportion to how few there are; a low share is
 * left alone, and four or more skills count as before.
 */
function skillFitOf(matched: number, total: number): number {
  if (total === 0) return NEUTRAL_SKILL_FIT;
  const share = matched / total;
  if (share <= NEUTRAL_SKILL_FIT || total >= MIN_SKILLS_FOR_FULL_CREDIT) return share;
  const confidence = total / MIN_SKILLS_FOR_FULL_CREDIT;
  return confidence * share + (1 - confidence) * NEUTRAL_SKILL_FIT;
}

/** Words that name a kind of job in any field: sharing only these says nothing about the field. */
const GENERIC_ROLE_WORDS = new Set([
  "engineer",
  "scientist",
  "analyst",
  "manager",
  "specialist",
  "consultant",
  "associate",
  "architect",
  "administrator",
  "coordinator",
  "representative",
  "executive",
  "officer",
  "technician",
  "strategist",
  "advisor",
]);

/**
 * A role sanity check: whether the job's title shares a word that names the field (not just
 * "Engineer") with at least one of the candidate's target titles. A target with no field word,
 * such as "Engineer", has nothing to check against, so it counts as a match.
 */
function sharesFieldWithTargets(jobTitle: string, targetTitles: string[]): boolean {
  const job = titleTokens(jobTitle);
  for (const target of targetTitles) {
    const field = [...titleTokens(target)].filter((word) => !GENERIC_ROLE_WORDS.has(word));
    if (field.length === 0 || field.some((word) => job.has(word))) return true;
  }
  return false;
}

/** The share of a title match that survives when only a job noun is shared and nothing backs it up. */
const NOUN_ONLY_TITLE_FACTOR = 0.25;
/** Matching skills that back up a role whose title shares no field word with the targets. */
const SKILLS_THAT_BACK_UP_A_TITLE = 3;

export function quickMatch(candidate: CandidateSignals, job: JobSignals): QuickMatch {
  const reasons: string[] = [];
  const have = new Set(candidate.skills.map((skill) => skill.toLowerCase()));
  const matchedSkills = job.skills.filter((skill) => have.has(skill.toLowerCase()));
  const missingSkills = job.skills.filter((skill) => !have.has(skill.toLowerCase()));
  const skillFit = skillFitOf(matchedSkills.length, job.skills.length);
  if (matchedSkills.length) {
    reasons.push(`${matchedSkills.length}/${job.skills.length} skills match`);
  }

  let titleFit = candidate.targetTitles.length
    ? Math.max(...candidate.targetTitles.map((title) => titleSimilarity(job.title, title)))
    : 0.5;
  // "Physical Design Engineer" shares only "Engineer" with "Data Engineer": that is a different
  // field, not half a match, unless the skills say otherwise.
  if (
    candidate.targetTitles.length &&
    matchedSkills.length < SKILLS_THAT_BACK_UP_A_TITLE &&
    !sharesFieldWithTargets(job.title, candidate.targetTitles)
  ) {
    titleFit *= NOUN_ONLY_TITLE_FACTOR;
  }
  if (titleFit >= 0.75) reasons.push("Title matches your target role");

  const location = locationFit(candidate, job);
  if (location.reason) reasons.push(location.reason);

  let score = skillFit * 50 + titleFit * 30 + location.fit * 20;
  const level = seniorityPenalty(candidate.seniority, job);
  score -= level.points;
  if (level.reason) reasons.push(level.reason);

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
