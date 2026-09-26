import { ValidationError } from "@gettargetrole/core/errors";
import { normalizeResume, type Resume } from "@gettargetrole/resume/schema";
import mammoth from "mammoth";
import type { z } from "zod";
import type { AiFeature } from "./config";
import { jobBlock, profileBlock, resumeJson, resumeText } from "./context";
import {
  ANSWERS_SYSTEM,
  COVER_LETTER_SYSTEM,
  GENERATE_SYSTEM,
  IMPORT_SYSTEM,
  INTERVIEW_SYSTEM,
  MATCH_SYSTEM,
  OUTREACH_SYSTEM,
  TAILOR_SYSTEM,
} from "./prompts";
import {
  applicationAnswersSchema,
  coverLetterSchema,
  fitAnalysisSchema,
  generateResultSchema,
  importResultSchema,
  interviewPrepSchema,
  outreachDraftSchema,
  tailorOutputSchema,
  tailorOutputStrictSchema,
  type ResumeChanges,
} from "./schemas";
import type { AiProvider, ChatTurn, ResumeSource } from "./types";
import { wrapUntrusted } from "./untrusted";

const MAX_TEXT_RESUME_CHARS = 60_000;
const MAX_HISTORY_TURNS = 24;
const HISTORY_DROP_TURNS = 12;
const LINKEDIN_NOTE_LIMIT = 300;

/** A block of a request: text, or a PDF the model reads directly. */
export type RequestPart =
  | { type: "text"; text: string }
  | { type: "pdf"; data: Buffer; fileName: string };

/**
 * One AI feature call, independent of vendor: the instructions, the parts that repeat across a
 * user's calls (sent first so providers can cache them), the per-call parts, the result schema,
 * and how the validated output becomes the feature's result. Every provider sends the same
 * prompt for a feature, so quality comparisons between models are like for like.
 */
export interface FeatureRequest<Output, Result> {
  feature: AiFeature;
  system: string;
  stable: string[];
  content: RequestPart[];
  schema: z.ZodType<Output>;
  /**
   * The same fields with every property required (nullable instead of optional), for vendors
   * whose strict structured outputs reject optional properties.
   */
  strictSchema?: z.ZodType;
  /** Claude: deliver the result through a tool; its grammar limit rejects this schema. */
  viaTool?: boolean;
  maxTokens?: number;
  finish: (output: Output) => Result;
}

const part = (text: string): RequestPart => ({ type: "text", text });

type Input<K extends keyof AiProvider> = AiProvider[K] extends (
  input: infer I,
  ...rest: never[]
) => unknown
  ? I
  : never;

/** Merges an edit into the resume: sections that are set replace the existing ones. */
export function applyResumeChanges(
  resume: Resume,
  changes: Partial<Omit<ResumeChanges, "change_summary">>,
): Resume {
  return normalizeResume({
    basics: changes.basics ?? resume.basics,
    summary: changes.summary ?? resume.summary,
    experience: changes.experience ?? resume.experience,
    education: changes.education ?? resume.education,
    skills: changes.skills ?? resume.skills,
    projects: changes.projects ?? resume.projects,
    certifications: changes.certifications ?? resume.certifications,
    customSections: changes.customSections ?? resume.customSections,
  });
}

/** The resume to import as request parts: PDFs go to the model as documents, the rest as text. */
export async function resumeSourceParts(source: ResumeSource): Promise<RequestPart[]> {
  const instruction = part("Convert this resume into the structured format.");
  if (source.kind === "pdf") {
    return [{ type: "pdf", data: source.data, fileName: source.fileName }, instruction];
  }
  let raw = source.kind === "text" ? source.text : "";
  if (source.kind === "docx") {
    try {
      raw = (await mammoth.extractRawText({ buffer: source.data })).value;
    } catch {
      throw new ValidationError(
        "We couldn't read that Word file. Try saving it again as .docx or upload a PDF.",
      );
    }
  }
  const cleaned = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length < 50) {
    throw new ValidationError("That file doesn't contain enough readable text to import.");
  }
  if (cleaned.length > MAX_TEXT_RESUME_CHARS) {
    throw new ValidationError(
      "That resume is too long to import. Please upload a shorter version.",
    );
  }
  return [part(wrapUntrusted("document", cleaned)), instruction];
}

export async function importRequest(source: ResumeSource) {
  return {
    feature: "import",
    system: IMPORT_SYSTEM,
    stable: [],
    content: await resumeSourceParts(source),
    schema: importResultSchema,
    finish: (result) => ({ ...result, resume: normalizeResume(result.resume) }),
  } satisfies FeatureRequest<z.infer<typeof importResultSchema>, unknown>;
}

export function generateRequest(input: Input<"generateResume">) {
  return {
    feature: "generate",
    system: GENERATE_SYSTEM,
    stable: [],
    content: [
      part(profileBlock(input.profile)),
      part(wrapUntrusted("background", input.background)),
      part(`Write my resume for this target role: ${input.targetRole}`),
    ],
    schema: generateResultSchema,
    finish: (result) => ({ ...result, resume: normalizeResume(result.resume) }),
  } satisfies FeatureRequest<z.infer<typeof generateResultSchema>, unknown>;
}

export function tailorRequest(input: Input<"tailorResume">) {
  return {
    feature: "tailor",
    system: TAILOR_SYSTEM,
    stable: [resumeJson(input.resume)],
    content: [
      part(jobBlock(input.job)),
      part(
        input.instructions
          ? `Tailor my resume for this job. Extra instructions from me: ${input.instructions}`
          : "Tailor my resume for this job.",
      ),
    ],
    schema: tailorOutputSchema,
    strictSchema: tailorOutputStrictSchema,
    // A resume's worth of sections plus notes is too large for a structured output's grammar.
    viaTool: true,
    finish: ({
      headline,
      summaryOfChanges,
      addedKeywords,
      missingKeywords,
      suggestions,
      ...sections
    }) => ({
      resume: applyResumeChanges(input.resume, {
        ...sections,
        basics: headline ? { ...input.resume.basics, headline } : null,
      }),
      summaryOfChanges,
      addedKeywords,
      missingKeywords,
      suggestions,
    }),
  } satisfies FeatureRequest<z.infer<typeof tailorOutputSchema>, unknown>;
}

export function fitRequest(input: Input<"analyzeFit">) {
  return {
    feature: "match",
    system: MATCH_SYSTEM,
    stable: [resumeText(input.resume), profileBlock(input.profile)],
    content: [part(jobBlock(input.job)), part("How well do I fit this job?")],
    schema: fitAnalysisSchema,
    maxTokens: 16_000,
    finish: (result) => ({
      ...result,
      score: Math.max(0, Math.min(100, Math.round(result.score))),
    }),
  } satisfies FeatureRequest<z.infer<typeof fitAnalysisSchema>, unknown>;
}

export function coverLetterRequest(input: Input<"writeCoverLetter">) {
  return {
    feature: "cover_letter",
    system: COVER_LETTER_SYSTEM,
    stable: [resumeText(input.resume), profileBlock(input.profile)],
    content: [
      part(jobBlock(input.job)),
      part(
        input.recipientName
          ? `Write my cover letter, addressed to ${input.recipientName}.`
          : "Write my cover letter.",
      ),
    ],
    schema: coverLetterSchema,
    maxTokens: 16_000,
    finish: (result) => result,
  } satisfies FeatureRequest<z.infer<typeof coverLetterSchema>, unknown>;
}

export function answersRequest(input: Input<"answerQuestions">) {
  const questions = input.questions
    .map((question, index) => `${index + 1}. ${question}`)
    .join("\n");
  return {
    feature: "answers",
    system: ANSWERS_SYSTEM,
    stable: [resumeText(input.resume), profileBlock(input.profile)],
    content: [
      part(jobBlock(input.job)),
      part(`Answer these application questions for me:\n${questions}`),
    ],
    schema: applicationAnswersSchema,
    maxTokens: 16_000,
    finish: (result) => result,
  } satisfies FeatureRequest<z.infer<typeof applicationAnswersSchema>, unknown>;
}

export function outreachRequest(input: Input<"draftOutreach">) {
  const recipient = input.recipient?.name
    ? `The recipient is ${input.recipient.name}${input.recipient.title ? `, ${input.recipient.title}` : ""}.`
    : "I don't know the recipient's name yet.";
  return {
    feature: "outreach",
    system: OUTREACH_SYSTEM,
    stable: [resumeText(input.resume), profileBlock(input.profile)],
    content: [part(jobBlock(input.job)), part(`${recipient} Draft my outreach.`)],
    schema: outreachDraftSchema,
    maxTokens: 16_000,
    finish: (draft) => ({
      ...draft,
      linkedinNote: draft.linkedinNote.slice(0, LINKEDIN_NOTE_LIMIT),
    }),
  } satisfies FeatureRequest<z.infer<typeof outreachDraftSchema>, unknown>;
}

export function interviewRequest(input: Input<"prepareInterview">) {
  return {
    feature: "interview",
    system: INTERVIEW_SYSTEM,
    stable: [resumeText(input.resume)],
    content: [part(jobBlock(input.job)), part("Prepare me for interviews.")],
    schema: interviewPrepSchema,
    finish: (result) => result,
  } satisfies FeatureRequest<z.infer<typeof interviewPrepSchema>, unknown>;
}

/** The Studio's latest user turn: the job and profile when known, the current resume, the ask. */
export function studioTurnParts(input: Input<"studioChat">): string[] {
  const parts: string[] = [];
  if (input.job) parts.push(jobBlock(input.job));
  if (input.profile) parts.push(profileBlock(input.profile));
  parts.push(resumeJson(input.resume, "current_resume"), input.message);
  return parts;
}

/**
 * The recent Studio conversation, starting at a user turn. Old turns drop off in blocks of
 * HISTORY_DROP_TURNS, so the start of the window, and with it a cached prompt prefix, stays put
 * between drops.
 */
export function recentHistory(history: ChatTurn[]): ChatTurn[] {
  const overflow = history.length - MAX_HISTORY_TURNS;
  const start = overflow > 0 ? Math.ceil(overflow / HISTORY_DROP_TURNS) * HISTORY_DROP_TURNS : 0;
  const recent = history.slice(start);
  const firstUser = recent.findIndex((turn) => turn.role === "user");
  return firstUser === -1 ? [] : recent.slice(firstUser);
}
