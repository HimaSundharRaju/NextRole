import type { Resume } from "@gettargetrole/resume/schema";
import type { AiFeature } from "./config";
import type {
  ApplicationAnswers,
  CoverLetter,
  FitAnalysis,
  GenerateResult,
  ImportResult,
  InterviewPrep,
  OutreachDraft,
  TailorResult,
} from "./schemas";

export interface UsageRecord {
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number;
}

export interface AiCallContext {
  userId: string | null;
  /** Called once per model call with token usage; used for metering and quotas. */
  onUsage?: (record: UsageRecord) => void | Promise<void>;
  signal?: AbortSignal;
}

/** Profile facts the AI may use (never guessed when missing). */
export interface CandidateProfile {
  targetTitles: string[];
  workAuthorization: string;
  needsSponsorship: boolean;
  minSalary: number | null;
  salaryCurrency: string;
  voiceNotes: string;
  phone: string;
  linkedinUrl: string;
}

export interface JobContext {
  title: string;
  company: string;
  location: string;
  description: string;
}

export type ResumeSource =
  | { kind: "pdf"; data: Buffer; fileName: string }
  | { kind: "docx"; data: Buffer; fileName: string }
  | { kind: "text"; text: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type StudioEvent =
  | { type: "text"; text: string }
  | { type: "resume"; resume: Resume; summary: string }
  | { type: "done"; reply: string; changed: boolean }
  | { type: "error"; message: string };

export interface AiProvider {
  readonly name: "anthropic" | "mock";
  readonly model: string;
  importResume(source: ResumeSource, ctx: AiCallContext): Promise<ImportResult>;
  generateResume(
    input: { background: string; targetRole: string; profile?: CandidateProfile | null },
    ctx: AiCallContext,
  ): Promise<GenerateResult>;
  tailorResume(
    input: { resume: Resume; job: JobContext; instructions?: string },
    ctx: AiCallContext,
  ): Promise<TailorResult>;
  analyzeFit(
    input: { resume: Resume; job: JobContext; profile?: CandidateProfile | null },
    ctx: AiCallContext,
  ): Promise<FitAnalysis>;
  writeCoverLetter(
    input: {
      resume: Resume;
      job: JobContext;
      profile?: CandidateProfile | null;
      recipientName?: string;
    },
    ctx: AiCallContext,
  ): Promise<CoverLetter>;
  answerQuestions(
    input: {
      resume: Resume;
      job: JobContext;
      profile?: CandidateProfile | null;
      questions: string[];
    },
    ctx: AiCallContext,
  ): Promise<ApplicationAnswers>;
  draftOutreach(
    input: {
      resume: Resume;
      job: JobContext;
      recipient?: { name: string; title: string } | null;
      profile?: CandidateProfile | null;
    },
    ctx: AiCallContext,
  ): Promise<OutreachDraft>;
  prepareInterview(
    input: { resume: Resume; job: JobContext },
    ctx: AiCallContext,
  ): Promise<InterviewPrep>;
  studioChat(
    input: {
      resume: Resume;
      history: ChatTurn[];
      message: string;
      job?: JobContext | null;
      profile?: CandidateProfile | null;
    },
    ctx: AiCallContext,
  ): AsyncGenerator<StudioEvent>;
}
