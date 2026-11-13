import type { Seniority } from "@gettargetrole/db/schema";

/*
 * What a job title says about the level of the role. Boards send no level or years for most
 * postings (none of the 6,491 in the local dev database has either), so until AI enrichment has
 * read a post the title is the only signal there is. These are plain patterns, not guesses at
 * meaning: a title with no cue has no level.
 *
 * The same rules run in two places, so they are written once, here: `seniorityFromTitle` for
 * scoring, and `withinMaxYears` (years-filter.ts) for the job board's "up to N years" filter,
 * which has to read titles inside Postgres. Patterns stay in the subset both regex engines share;
 * `\b` is translated to Postgres's `\y`.
 */

interface TitleRule {
  level: Seniority;
  pattern: RegExp;
  /** Titles that match `pattern` but whose cue means something else. */
  unless?: RegExp;
}

/** Job nouns a level numeral can follow: "Software Engineer II", "Support Specialist 3". */
const NOUNS_BEFORE_NUMERAL =
  "engineer|developer|programmer|scientist|analyst|designer|specialist|architect|consultant|accountant|recruiter|writer|researcher|executive|representative|administrator|technician|strategist|coordinator|partner|associate|tse|sde|swe";

/** "Senior or Staff", "Senior/Staff": a title that offers a range names the lowest level. */
const OR_TO = String.raw`(?:\W+(?:or|to)\W+|\s*\/\s*)`;

/**
 * In precedence order: the first rule that matches decides. Ranges and "mid-level" come first so
 * "Engineer (Mid-Level, Senior or Staff)" reads as the lowest level it offers; then the levels
 * from the top down, so "Senior Staff Engineer" is staff and "Senior Manager, Head of Talent" is
 * a director.
 */
const RULES: TitleRule[] = [
  { level: "mid", pattern: /\b(?:mid[- ]?level|intermediate)\b/i },
  {
    level: "senior",
    pattern: new RegExp(String.raw`\b(?:senior|sr)\b${OR_TO}(?:staff|principal|lead)\b`, "i"),
  },

  {
    level: "executive",
    // Only at the start: "Executive Assistant, Chief People Officer" assists a chief; it isn't one.
    pattern:
      /^(?:(?:global|regional|deputy|senior)\.?\s+)*(?:vice\s+president|vp|svp|evp|chief|president)\b/i,
  },
  { level: "director", pattern: /\b(?:director|head of)\b|\bassociate\s+general\s+counsel\b/i },
  { level: "principal", pattern: /\b(?:principal|distinguished)\b/i },
  {
    level: "staff",
    pattern: /\bstaff\b/i,
    // "Member of Technical Staff" is a title for engineers of every level; "Staff Accountant" is
    // a job, not a level.
    unless:
      /\btechnical\s+staff\b|\bstaff\s+(?:accountant|attorney|nurse|auditor|assistant|writer|pharmacist|physician|therapist|technician)\b/i,
  },
  { level: "manager", pattern: /\bengineering\s+manager\b|^manager\b/i },
  {
    level: "senior",
    pattern: /\b(?:senior|sr|lead)\b/i,
    unless: /\blead\s+gen(?:eration)?\b/i,
  },
  {
    level: "senior",
    pattern: new RegExp(String.raw`\b(?:${NOUNS_BEFORE_NUMERAL})\s+(?:III|IV|3|4)\b`, "i"),
  },
  {
    level: "mid",
    pattern: new RegExp(String.raw`\b(?:${NOUNS_BEFORE_NUMERAL})\s+(?:II|2)\b`, "i"),
  },
  {
    level: "entry",
    pattern: /\b(?:junior|jr|entry[- ]level|new\s+grad(?:uate)?|graduate|early\s+career)\b/i,
  },
  {
    // "Associate Product Manager" is entry level; "Operations Associate" and "Associate Director"
    // are not.
    level: "entry",
    pattern: /^associate\s+\w/i,
    unless: /^associate\s+(?:director|general\s+counsel|vice|vp|partner|manager|principal)\b/i,
  },
  {
    level: "entry",
    pattern: new RegExp(String.raw`\b(?:${NOUNS_BEFORE_NUMERAL})\s+(?:I|1)\b`, "i"),
  },
  { level: "intern", pattern: /\b(?:interns?|internship|co-op)\b/i },
];

/** The level a job title reads as, or null when it has no cue. */
export function seniorityFromTitle(title: string): Seniority | null {
  for (const rule of RULES) {
    if (rule.pattern.test(title) && !rule.unless?.test(title)) return rule.level;
  }
  return null;
}

/**
 * The fewest years of experience each level typically asks for. Deliberately round: these only
 * decide whether a post with no years of its own is shown for "up to N years", where the
 * choices are 2, 5 and 8.
 */
export const IMPLIED_MIN_YEARS: Record<Seniority, number> = {
  intern: 0,
  entry: 0,
  mid: 2,
  senior: 5,
  manager: 5,
  staff: 8,
  principal: 10,
  director: 10,
  executive: 12,
};

/** How a level reads in a match's reasons, such as "Staff-level role". */
export const SENIORITY_ROLE_LABEL: Record<Seniority, string> = {
  intern: "Internship",
  entry: "Entry-level role",
  mid: "Mid-level role",
  senior: "Senior role",
  staff: "Staff-level role",
  principal: "Principal-level role",
  manager: "Management role",
  director: "Director-level role",
  executive: "Executive role",
};

export interface LeveledJob {
  title: string;
  /** The level and years a post states or enrichment read; they beat the title. */
  seniority?: Seniority | null;
  yearsMin?: number | null;
}

/**
 * Whether a job stays in the board's "up to `maxYears` years" filter: by the years the post
 * states, else by the level enrichment read or the title implies. A post that says nothing and
 * has no cue in its title stays. The Postgres twin is `withinMaxYears`.
 */
export function withinYears(job: LeveledJob, maxYears: number): boolean {
  if (job.yearsMin != null) return job.yearsMin <= maxYears;
  const level = job.seniority ?? seniorityFromTitle(job.title);
  return level === null || IMPLIED_MIN_YEARS[level] <= maxYears;
}

/** The rules as Postgres regexes (`~*`), for building the same reading into a query. */
export function postgresTitleRules(): Array<{
  level: Seniority;
  pattern: string;
  unless: string | null;
}> {
  const toPostgres = (pattern: RegExp) => pattern.source.replace(/\\b/g, String.raw`\y`);
  return RULES.map((rule) => ({
    level: rule.level,
    pattern: toPostgres(rule.pattern),
    unless: rule.unless ? toPostgres(rule.unless) : null,
  }));
}
