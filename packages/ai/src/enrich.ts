import { z } from "zod";
import { jobBlock, withoutBoilerplate } from "./context";
import type { FeatureRequest } from "./requests";
import type { JobContext } from "./types";
import { UNTRUSTED_CONTENT_RULE } from "./untrusted";

/*
 * Job enrichment: facts for the job board's filters and ranking that the deterministic parsers
 * miss, read by a small, cheap model. Every fact that drives a filter comes with the posting's
 * own words, and a fact whose quote isn't in the posting word for word is dropped.
 */

/** Hiring levels; the same list as `SENIORITY_LEVELS` in the database schema. */
export const SENIORITIES = [
  "intern",
  "entry",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
] as const;

export const EDUCATION_LEVELS = ["none", "bachelors", "masters", "phd"] as const;
export const CONTRACT_TERMS = ["w2", "c2c", "1099"] as const;

const quote = z
  .string()
  .nullable()
  .describe("The posting's exact words that state this, copied character for character");

/** What the model returns. Strict: every field present, null when the posting doesn't say. */
export const enrichmentOutputSchema = z.object({
  summary: z
    .string()
    .describe("One plain sentence, at most 25 words, on what the person in this role does"),
  seniority: z
    .enum(SENIORITIES)
    .nullable()
    .describe("The level the role is hired at, when the title or posting states it"),
  seniorityQuote: quote,
  yearsMin: z
    .number()
    .int()
    .nullable()
    .describe("The fewest years of experience required: 5 for '5+ years', 3 for '3-5 years'"),
  yearsQuote: quote,
  education: z.enum(EDUCATION_LEVELS).nullable().describe("The lowest degree required"),
  educationQuote: quote,
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string().nullable().describe("ISO 4217 code, such as USD"),
  salaryPeriod: z.enum(["year", "month", "hour"]).nullable(),
  salaryQuote: quote,
  contractTerms: z
    .array(z.enum(CONTRACT_TERMS))
    .describe("W-2, C2C (corp-to-corp) or 1099 arrangements the posting offers or accepts"),
  contractQuote: quote,
  workplace: z.enum(["remote", "hybrid", "onsite"]).nullable(),
  workplaceQuote: quote,
  sponsorship: z
    .enum(["yes", "no"])
    .nullable()
    .describe("Whether the employer says it can sponsor work visas"),
  sponsorshipQuote: quote,
  citizenshipRequired: z
    .boolean()
    .nullable()
    .describe("True when the role requires citizenship, U.S. person status or a clearance"),
  citizenshipQuote: quote,
  evergreen: z
    .boolean()
    .describe("True for a general application or talent pool rather than one opening"),
  evergreenQuote: quote,
});
export type EnrichmentOutput = z.infer<typeof enrichmentOutputSchema>;

export type QuotedField =
  | "seniority"
  | "years"
  | "education"
  | "salary"
  | "contract"
  | "workplace"
  | "sponsorship"
  | "citizenship"
  | "evergreen";

/** Enrichment after the quote check: only facts the posting's own words back up. */
export interface JobEnrichment {
  summary: string;
  seniority: (typeof SENIORITIES)[number] | null;
  yearsMin: number | null;
  education: (typeof EDUCATION_LEVELS)[number] | null;
  salary: {
    min: number;
    max: number;
    currency: string;
    period: "year" | "month" | "hour";
  } | null;
  contractTerms: Array<(typeof CONTRACT_TERMS)[number]>;
  workplace: "remote" | "hybrid" | "onsite" | null;
  sponsorship: "yes" | "no" | null;
  citizenshipRequired: boolean | null;
  evergreen: boolean;
  /** The quotes that were kept, for display and audits. */
  quotes: Partial<Record<QuotedField, string>>;
  /** Facts dropped because their quote wasn't in the posting. */
  dropped: QuotedField[];
}

export const ENRICH_SYSTEM = `You read job postings and pull out facts for a job board's filters.

Rules:
- State only what the posting says. When it doesn't say, use null (an empty list for contractTerms, false for evergreen).
- For every fact you give, copy the posting's exact words that state it into the matching quote field: a short phrase, character for character, never a paraphrase. A fact without a quote from the posting is discarded.
- yearsMin: the fewest years of experience the role requires ("5+ years" is 5, "3-5 years" is 3). Ignore years that describe the company or the team.
- education: the lowest degree required ("Bachelor's or equivalent experience" is bachelors); none when the posting says no degree is needed.
- salary: only pay for this role. period is year, month or hour; currency is an ISO code.
- contractTerms: only W-2, C2C (corp-to-corp) or 1099 arrangements the posting offers or accepts, not duties such as preparing tax forms.
- workplace: remote, hybrid or onsite, only when the posting says so.
- sponsorship: "no" when the employer says it can't sponsor visas now or in the future, "yes" when it says it can.
- citizenshipRequired: true when the role requires citizenship, U.S. person status or a security clearance.
- evergreen: true when the posting is a general application, talent community or "always hiring" pool rather than one opening.
- seniority: the level the role is hired at, only when the title or posting states it ("Senior" or "Staff" in the title, "entry-level", "new grad", "Director"). Quote those words; years of experience alone don't set it.
- summary: one plain sentence, at most 25 words, on what the person does. No marketing language.

${UNTRUSTED_CONTENT_RULE}`;

/** Enough of a posting to find its requirements; the rest costs tokens and adds nothing. */
const MAX_POSTING_CHARS = 12_000;

export function postingText(job: JobContext): string {
  const relevant = withoutBoilerplate(job.description);
  return relevant.length > MAX_POSTING_CHARS ? relevant.slice(0, MAX_POSTING_CHARS) : relevant;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
};

/** Decodes HTML entities (&mdash;, &#8212;, &#x2014;) left in a posting's text. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/**
 * Folds entities, case, whitespace and typographic punctuation, so a faithful quote matches the
 * posting however either of them writes a dash or an apostrophe.
 */
export function foldText(text: string): string {
  return decodeEntities(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** Numbers written in a quote: "120,000" is 120000, "$150k" is 150000, "5+" is 5. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([kK])?/g)].map((match) => {
    const value = Number(match[1]!.replace(/,/g, ""));
    return match[2] ? value * 1000 : value;
  });
}

/**
 * Keeps the facts whose quotes appear in the posting word for word, and whose numbers appear
 * in their quotes; drops the rest.
 */
export function verifyEnrichment(output: EnrichmentOutput, text: string): JobEnrichment {
  const posting = foldText(text);
  const quotes: Partial<Record<QuotedField, string>> = {};
  const dropped: QuotedField[] = [];
  const backed = (field: QuotedField, said: string | null, claimed: boolean): boolean => {
    if (!claimed) return false;
    const folded = said ? foldText(said) : "";
    if (folded.length >= 3 && posting.includes(folded)) {
      quotes[field] = said!.trim();
      return true;
    }
    dropped.push(field);
    return false;
  };

  const yearsOk =
    output.yearsMin !== null &&
    output.yearsMin >= 0 &&
    output.yearsMin <= 30 &&
    backed("years", output.yearsQuote, true) &&
    numbersIn(output.yearsQuote!).includes(output.yearsMin);
  if (!yearsOk && quotes.years) {
    delete quotes.years;
    dropped.push("years");
  }

  const { salaryMin: min, salaryMax: max } = output;
  const salaryClaimed = min !== null && output.salaryPeriod !== null;
  const salaryNumbers = backed("salary", output.salaryQuote, salaryClaimed)
    ? numbersIn(output.salaryQuote!)
    : [];
  const high = max ?? min;
  const salaryOk =
    salaryClaimed &&
    min! > 0 &&
    high! >= min! &&
    salaryNumbers.includes(min!) &&
    salaryNumbers.includes(high!);
  if (!salaryOk && quotes.salary) {
    delete quotes.salary;
    dropped.push("salary");
  }

  const currency = output.salaryCurrency?.toUpperCase() ?? "USD";
  return {
    summary: output.summary.trim().slice(0, 240),
    seniority: backed("seniority", output.seniorityQuote, output.seniority !== null)
      ? output.seniority
      : null,
    yearsMin: yearsOk ? output.yearsMin : null,
    education: backed("education", output.educationQuote, output.education !== null)
      ? output.education
      : null,
    salary: salaryOk
      ? {
          min: min!,
          max: high!,
          currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
          period: output.salaryPeriod!,
        }
      : null,
    contractTerms: backed("contract", output.contractQuote, output.contractTerms.length > 0)
      ? [...new Set(output.contractTerms)]
      : [],
    workplace: backed("workplace", output.workplaceQuote, output.workplace !== null)
      ? output.workplace
      : null,
    sponsorship: backed("sponsorship", output.sponsorshipQuote, output.sponsorship !== null)
      ? output.sponsorship
      : null,
    citizenshipRequired: backed(
      "citizenship",
      output.citizenshipQuote,
      output.citizenshipRequired !== null,
    )
      ? output.citizenshipRequired
      : null,
    evergreen: backed("evergreen", output.evergreenQuote, output.evergreen),
    quotes,
    dropped,
  };
}

/** One posting's enrichment request: the same prompt on any vendor, live or in a batch. */
export function enrichRequest(job: JobContext) {
  const text = postingText(job);
  return {
    feature: "enrich",
    system: ENRICH_SYSTEM,
    stable: [],
    content: [{ type: "text", text: jobBlock({ ...job, description: text }) }],
    schema: enrichmentOutputSchema,
    maxTokens: 1_500,
    finish: (output: EnrichmentOutput) => verifyEnrichment(output, `${job.title}\n${text}`),
  } satisfies FeatureRequest<EnrichmentOutput, JobEnrichment>;
}
