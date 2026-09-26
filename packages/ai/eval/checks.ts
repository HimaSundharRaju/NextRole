/*
 * Automatic checks that catch the failures that matter most on a resume: invented employers,
 * titles, dates, skills or metrics. A cheaper model may not fail more of them than the reference.
 */
import type { Resume } from "@gettargetrole/resume/schema";
import { findSkills } from "@gettargetrole/resume/skills";
import { resumeToPlainText } from "@gettargetrole/resume/text";
import type {
  ApplicationAnswers,
  CoverLetter,
  FitAnalysis,
  ImportResult,
  InterviewPrep,
  OutreachDraft,
  TailorResult,
} from "../src/schemas";
import type { CandidateProfile, JobContext } from "../src/types";

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

const NUMBER = /(\$)?(\d[\d,]*(?:\.\d+)?)\s?(%|x\b|k\b|m\b|b\b|\+)?/gi;
// "15-minute chat", "2 weeks": scheduling phrases, not claims.
const TIME_PHRASE = /^[\s-]*(?:minutes?|mins?|hours?|days?|weeks?|months?)\b/i;

const coreOf = (digits: string) => digits.replace(/,/g, "").replace(/\.0+$/, "");

/**
 * Numbers that carry a claim: two or more digits, or any number with a unit (40%, 3x, $2M,
 * 20,000). Years, single bare digits and time phrases are skipped.
 */
export function claimNumbers(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(NUMBER)) {
    const core = coreOf(match[2]!);
    const unit = match[1] ?? match[3];
    const value = Number(core);
    if (!unit && core.length < 2) continue;
    if (!unit && core.length === 4 && value >= 1950 && value <= 2035) continue;
    if (TIME_PHRASE.test(text.slice(match.index! + match[0].length))) continue;
    found.add(core);
  }
  return found;
}

/** Every number in the sources, however it's written ("6 engineers" supports "6+"). */
function allNumbers(text: string): Set<string> {
  return new Set([...text.matchAll(NUMBER)].map((match) => coreOf(match[2]!)));
}

export function inventedNumbers(output: string, sources: string[]): string[] {
  const allowed = new Set(sources.flatMap((source) => [...allNumbers(source)]));
  return [...claimNumbers(output)].filter((number) => !allowed.has(number));
}

const roleKey = (role: Resume["experience"][number]) =>
  [role.company, role.title, role.startDate, role.endDate].map(norm).join("|");
const educationKey = (entry: Resume["education"][number]) =>
  [entry.institution, entry.degree, entry.field, entry.endDate].map(norm).join("|");

function factFailures(source: Resume, output: Resume): string[] {
  const failures: string[] = [];
  const roles = new Set(source.experience.map(roleKey));
  for (const role of output.experience) {
    if (!roles.has(roleKey(role)))
      failures.push(`changed or invented role: ${role.company} — ${role.title}`);
  }
  const schools = new Set(source.education.map(educationKey));
  for (const entry of output.education) {
    if (!schools.has(educationKey(entry))) failures.push(`changed education: ${entry.institution}`);
  }
  // Technical skills (the app's taxonomy) the resume didn't show are claims the candidate can't
  // back up. Soft skills ("cross-functional collaboration") are left to the judges.
  const known = new Set(findSkills(resumeToPlainText(source)));
  for (const skill of findSkills(resumeToPlainText(output))) {
    if (!known.has(skill)) failures.push(`skill not on the resume: ${skill}`);
  }
  const { headline: _headline, ...contact } = output.basics;
  const { headline: _sourceHeadline, ...sourceContact } = source.basics;
  if (JSON.stringify(contact) !== JSON.stringify(sourceContact))
    failures.push("contact details changed");
  return failures;
}

export function checkTailor(source: Resume, result: TailorResult): string[] {
  const failures = factFailures(source, result.resume);
  const before = resumeToPlainText(source);
  const after = resumeToPlainText(result.resume);
  for (const number of inventedNumbers(after, [before]))
    failures.push(`invented number: ${number}`);
  // Length is judged, not checked; only losing half the resume counts as a failure.
  const ratio = after.length / before.length;
  if (ratio < 0.5) failures.push(`dropped too much (${Math.round(ratio * 100)}% of the original)`);
  if (result.summaryOfChanges.length === 0) failures.push("no summary of changes");
  return failures;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function checkCoverLetter(source: Resume, job: JobContext, letter: CoverLetter): string[] {
  const failures: string[] = [];
  const count = words(letter.body);
  if (count < 120 || count > 450) failures.push(`${count} words`);
  if (/\[[^\]]{2,}\]/.test(letter.body)) failures.push("placeholder left in");
  for (const number of inventedNumbers(letter.body, [resumeToPlainText(source), job.description])) {
    failures.push(`invented number: ${number}`);
  }
  return failures;
}

export function checkAnswers(
  source: Resume,
  job: JobContext,
  profile: CandidateProfile,
  questions: string[],
  result: ApplicationAnswers,
): string[] {
  const failures: string[] = [];
  if (result.answers.length !== questions.length) {
    failures.push(`${result.answers.length} answers for ${questions.length} questions`);
  }
  for (const item of result.answers) {
    if (!item.answer.trim()) failures.push(`empty answer: ${item.question}`);
    for (const number of inventedNumbers(item.answer, [
      resumeToPlainText(source),
      job.description,
    ])) {
      failures.push(`invented number: ${number}`);
    }
  }
  const sponsorship = result.answers.find((item) => /sponsor/i.test(item.question));
  if (sponsorship) {
    const says = norm(sponsorship.answer);
    const yes = /\byes\b|\bwill (?:need|require)\b|\brequire sponsorship\b/.test(says);
    const no = /\bno\b|\bnot\b|\bdon't\b|\bdo not\b|\bwon't\b/.test(says);
    if (profile.needsSponsorship ? !yes : !no || yes)
      failures.push("sponsorship answer contradicts the profile");
  }
  return failures;
}

export function checkOutreach(source: Resume, job: JobContext, draft: OutreachDraft): string[] {
  const failures: string[] = [];
  if (draft.linkedinNote.length > 300) failures.push("LinkedIn note over 300 characters");
  const text = [draft.email.body, draft.linkedinNote, draft.followUp.body].join("\n");
  for (const number of inventedNumbers(text, [resumeToPlainText(source), job.description])) {
    failures.push(`invented number: ${number}`);
  }
  return failures;
}

export function verdictFor(score: number): FitAnalysis["verdict"] {
  if (score >= 80) return "strong";
  if (score >= 65) return "good";
  if (score >= 50) return "stretch";
  return "poor";
}

export function checkFit(fit: FitAnalysis): string[] {
  const failures: string[] = [];
  if (fit.score < 0 || fit.score > 100) failures.push(`score ${fit.score} out of range`);
  if (verdictFor(fit.score) !== fit.verdict)
    failures.push(`verdict ${fit.verdict} for score ${fit.score}`);
  if (fit.strengths.length === 0) failures.push("no strengths");
  return failures;
}

export function checkInterview(source: Resume, job: JobContext, prep: InterviewPrep): string[] {
  const failures: string[] = [];
  if (prep.questions.length < 5) failures.push(`${prep.questions.length} questions`);
  if (prep.questions.some((item) => !item.answerOutline.trim()))
    failures.push("empty answer outline");
  const outlines = prep.questions.map((item) => item.answerOutline).join("\n");
  for (const number of inventedNumbers(outlines, [resumeToPlainText(source), job.description])) {
    failures.push(`invented number: ${number}`);
  }
  return failures;
}

/** An import must reproduce the resume: same person, same roles and dates, most skills. */
export function checkImport(truth: Resume, result: ImportResult): string[] {
  const failures: string[] = [];
  const got = result.resume;
  if (norm(got.basics.name) !== norm(truth.basics.name)) failures.push(`name: ${got.basics.name}`);
  if (norm(got.basics.email) !== norm(truth.basics.email))
    failures.push(`email: ${got.basics.email}`);
  const truthRoles = new Set(truth.experience.map(roleKey));
  const gotRoles = new Set(got.experience.map(roleKey));
  const matched = [...truthRoles].filter((key) => gotRoles.has(key)).length;
  if (matched < truthRoles.size) failures.push(`${truthRoles.size - matched} roles misread`);
  const invented = [...gotRoles].filter((key) => !truthRoles.has(key));
  if (invented.length > 0 && matched === truthRoles.size)
    failures.push(`${invented.length} extra roles`);
  const truthSkills = truth.skills.flatMap((group) => group.items.map(norm));
  const gotSkills = new Set(got.skills.flatMap((group) => group.items.map(norm)));
  const recalled = truthSkills.filter((skill) => gotSkills.has(skill)).length;
  if (truthSkills.length > 0 && recalled / truthSkills.length < 0.8) {
    failures.push(`${recalled}/${truthSkills.length} skills`);
  }
  const bullets = (resume: Resume) =>
    resume.experience.flatMap((role) => role.highlights).join("\n");
  for (const number of inventedNumbers(bullets(got), [resumeToPlainText(truth)])) {
    failures.push(`invented number: ${number}`);
  }
  return failures;
}

/** A Studio edit may only touch the sections the request is about. */
export function checkStudioEdit(
  before: Resume,
  after: Resume | null,
  sections: Array<keyof Resume>,
  expect?: (after: Resume) => boolean,
): string[] {
  if (!after) return ["no edit applied"];
  const failures: string[] = [];
  for (const key of Object.keys(before) as Array<keyof Resume>) {
    if (sections.includes(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) failures.push(`changed ${key}`);
  }
  if (sections.includes("basics")) {
    const { headline: _a, ...rest } = before.basics;
    const { headline: _b, ...restAfter } = after.basics;
    if (JSON.stringify(rest) !== JSON.stringify(restAfter))
      failures.push("changed contact details");
  }
  if (expect && !expect(after)) failures.push("didn't make the requested change");
  if (sections.includes("experience")) {
    for (const number of inventedNumbers(resumeToPlainText(after), [resumeToPlainText(before)])) {
      failures.push(`invented number: ${number}`);
    }
  }
  return failures;
}
