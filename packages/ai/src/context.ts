import type { Resume } from "@gettargetrole/resume/schema";
import { resumeToPlainText } from "@gettargetrole/resume/text";
import type { CandidateProfile, JobContext } from "./types";
import { wrapUntrusted } from "./untrusted";

// Job pages occasionally embed huge boilerplate; beyond this the text is almost certainly noise.
const MAX_JOB_DESCRIPTION_CHARS = 60_000;

/**
 * Legal notices that job posts append: equal-opportunity and accommodation statements, applicant
 * privacy notices, background-check and E-Verify disclosures. They say nothing about the role, so
 * prompts leave them out to save tokens; the stored description is unchanged.
 */
// Notices address the reader ("we are committed…", "if you need…"); a job duty with the same
// words ("Coordinate accommodations for candidates") is written as an instruction instead.
const ADDRESSES_READER = String.raw`(?=.*\b(?:we|our|us|you|your)\b)`;

const BOILERPLATE = [
  /\bequal (?:employment )?opportunity employer\b/i,
  /\baffirmative action\b/i,
  /\b(?:do|does|will) not discriminate (?:on the basis|based on)\b/i,
  /\bwithout regard to (?:race|color|religion|sex|gender|age|national origin)\b/i,
  new RegExp(`^${ADDRESSES_READER}(?=.*\\breasonable accommodations?\\b)`, "i"),
  new RegExp(`^${ADDRESSES_READER}(?=.*\\bdisabilit(?:y|ies)\\b)(?=.*\\baccommodations?\\b)`, "i"),
  /\b(?:applicant|candidate|recruitment) privacy (?:notice|policy|statement)\b/i,
  /\bprivacy (?:notice|policy) for (?:job )?(?:applicants|candidates)\b/i,
  /\bE-Verify\b/i,
  /\bfair chance (?:ordinance|act|initiative|hiring)\b/i,
  /\b(?:arrest|conviction) records?\b/i,
  new RegExp(`^${ADDRESSES_READER}(?=.*\\bcriminal history\\b)`, "i"),
  /\bjob posting is non-compliant\b/i,
];

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z"“(])/;
const isBoilerplate = (text: string) => BOILERPLATE.some((pattern) => pattern.test(text));

/**
 * Drops legal paragraphs. A paragraph that is mostly about the company or the job keeps its
 * other sentences ("Stripe is an equal opportunity employer. We look for people who…").
 */
export function withoutBoilerplate(description: string): string {
  return description
    .split("\n")
    .flatMap((line) => {
      if (!isBoilerplate(line)) return [line];
      const sentences = line.split(SENTENCE_BREAK);
      const kept = sentences.filter((sentence) => !isBoilerplate(sentence));
      return kept.length * 2 >= sentences.length ? [kept.join(" ")] : [];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function resumeJson(resume: Resume, tag = "resume"): string {
  return wrapUntrusted(tag, JSON.stringify(resume, null, 1));
}

export function resumeText(resume: Resume): string {
  return wrapUntrusted("resume", resumeToPlainText(resume));
}

export function jobBlock(job: JobContext): string {
  const relevant = withoutBoilerplate(job.description);
  const description =
    relevant.length > MAX_JOB_DESCRIPTION_CHARS
      ? `${relevant.slice(0, MAX_JOB_DESCRIPTION_CHARS)}\n[description truncated]`
      : relevant;
  return wrapUntrusted(
    "job_description",
    [
      `Title: ${job.title}`,
      `Company: ${job.company}`,
      `Location: ${job.location || "Not stated"}`,
      "",
      description,
    ].join("\n"),
  );
}

export function profileBlock(profile: CandidateProfile | null | undefined): string {
  if (!profile) return wrapUntrusted("candidate_profile", "No profile details provided.");
  const salary = profile.minSalary
    ? `${profile.salaryCurrency} ${profile.minSalary.toLocaleString("en-US")} minimum`
    : "Not provided";
  return wrapUntrusted(
    "candidate_profile",
    [
      `Target roles: ${profile.targetTitles.join(", ") || "Not provided"}`,
      `Work authorization: ${profile.workAuthorization || "Not provided"}`,
      `Needs visa sponsorship: ${profile.workAuthorization ? (profile.needsSponsorship ? "Yes" : "No") : "Not provided"}`,
      `Salary expectation: ${salary}`,
      `Phone: ${profile.phone || "Not provided"}`,
      `LinkedIn: ${profile.linkedinUrl || "Not provided"}`,
      `Voice and extra context from the candidate: ${profile.voiceNotes || "None"}`,
    ].join("\n"),
  );
}
