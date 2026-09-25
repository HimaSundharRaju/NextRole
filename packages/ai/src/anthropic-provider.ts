import Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ValidationError } from "@nextrole/core/errors";
import { createLogger } from "@nextrole/core/logger";
import { normalizeResume, type Resume } from "@nextrole/resume/schema";
import mammoth from "mammoth";
import { z } from "zod";
import {
  assertUsable,
  FALLBACK_PARAMS,
  getAnthropic,
  mapAnthropicError,
  recordUsage,
  runStructured,
  textOf,
} from "./client";
import { configuredModel, FEATURE_EFFORT } from "./config";
import { jobBlock, profileBlock, resumeJson, resumeText } from "./context";
import {
  ANSWERS_SYSTEM,
  COVER_LETTER_SYSTEM,
  GENERATE_SYSTEM,
  IMPORT_SYSTEM,
  INTERVIEW_SYSTEM,
  MATCH_SYSTEM,
  OUTREACH_SYSTEM,
  STUDIO_SYSTEM,
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
  resumeChangesSchema,
  tailorResultSchema,
  type ResumeChanges,
} from "./schemas";
import type { AiProvider, ChatTurn, ResumeSource, StudioEvent } from "./types";
import { wrapUntrusted } from "./untrusted";

const log = createLogger("ai-studio");

const MAX_TEXT_RESUME_CHARS = 60_000;
const MAX_HISTORY_TURNS = 24;
const LINKEDIN_NOTE_LIMIT = 300;

const text = (value: string): BetaContentBlockParam => ({ type: "text", text: value });

export async function resumeSourceToContent(
  source: ResumeSource,
): Promise<BetaContentBlockParam[]> {
  const instruction = text("Convert this resume into the structured format.");
  if (source.kind === "pdf") {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: source.data.toString("base64"),
        },
        title: source.fileName,
      },
      instruction,
    ];
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
  return [text(wrapUntrusted("document", cleaned)), instruction];
}

/** Merges a Studio edit into the resume: non-null sections replace the existing ones. */
export function applyResumeChanges(resume: Resume, changes: ResumeChanges): Resume {
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

export const UPDATE_RESUME_TOOL: BetaTool = {
  name: "update_resume",
  description:
    "Apply edits to the user's resume, which is shown live next to the chat. Set every section you are not changing to null. A non-null section replaces that entire section, so include all of its entries.",
  input_schema: transformJSONSchema(
    z.toJSONSchema(resumeChangesSchema),
  ) as BetaTool["input_schema"],
  strict: true,
  eager_input_streaming: true,
};

function historyToMessages(history: ChatTurn[]): BetaMessageParam[] {
  const recent = history.slice(-MAX_HISTORY_TURNS);
  const firstUser = recent.findIndex((turn) => turn.role === "user");
  return firstUser === -1
    ? []
    : recent.slice(firstUser).map((turn) => ({ role: turn.role, content: turn.content }));
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;

  get model(): string {
    return configuredModel();
  }

  async importResume(source: ResumeSource, ctx: Parameters<AiProvider["importResume"]>[1]) {
    const result = await runStructured({
      feature: "import",
      system: IMPORT_SYSTEM,
      content: await resumeSourceToContent(source),
      schema: importResultSchema,
      ctx,
    });
    return { ...result, resume: normalizeResume(result.resume) };
  }

  async generateResume(
    input: Parameters<AiProvider["generateResume"]>[0],
    ctx: Parameters<AiProvider["generateResume"]>[1],
  ) {
    const result = await runStructured({
      feature: "generate",
      system: GENERATE_SYSTEM,
      content: [
        text(profileBlock(input.profile)),
        text(wrapUntrusted("background", input.background)),
        text(`Write my resume for this target role: ${input.targetRole}`),
      ],
      schema: generateResultSchema,
      ctx,
    });
    return { ...result, resume: normalizeResume(result.resume) };
  }

  async tailorResume(
    input: Parameters<AiProvider["tailorResume"]>[0],
    ctx: Parameters<AiProvider["tailorResume"]>[1],
  ) {
    const result = await runStructured({
      feature: "tailor",
      system: TAILOR_SYSTEM,
      content: [
        text(jobBlock(input.job)),
        text(resumeJson(input.resume)),
        text(
          input.instructions
            ? `Tailor my resume for this job. Extra instructions from me: ${input.instructions}`
            : "Tailor my resume for this job.",
        ),
      ],
      schema: tailorResultSchema,
      ctx,
    });
    return { ...result, resume: normalizeResume(result.resume) };
  }

  async analyzeFit(
    input: Parameters<AiProvider["analyzeFit"]>[0],
    ctx: Parameters<AiProvider["analyzeFit"]>[1],
  ) {
    const result = await runStructured({
      feature: "match",
      system: MATCH_SYSTEM,
      content: [
        text(jobBlock(input.job)),
        text(resumeText(input.resume)),
        text(profileBlock(input.profile)),
        text("How well do I fit this job?"),
      ],
      schema: fitAnalysisSchema,
      ctx,
      maxTokens: 16_000,
    });
    return { ...result, score: Math.max(0, Math.min(100, Math.round(result.score))) };
  }

  async writeCoverLetter(
    input: Parameters<AiProvider["writeCoverLetter"]>[0],
    ctx: Parameters<AiProvider["writeCoverLetter"]>[1],
  ) {
    return runStructured({
      feature: "cover_letter",
      system: COVER_LETTER_SYSTEM,
      content: [
        text(jobBlock(input.job)),
        text(resumeText(input.resume)),
        text(profileBlock(input.profile)),
        text(
          input.recipientName
            ? `Write my cover letter, addressed to ${input.recipientName}.`
            : "Write my cover letter.",
        ),
      ],
      schema: coverLetterSchema,
      ctx,
      maxTokens: 16_000,
    });
  }

  async answerQuestions(
    input: Parameters<AiProvider["answerQuestions"]>[0],
    ctx: Parameters<AiProvider["answerQuestions"]>[1],
  ) {
    const questions = input.questions
      .map((question, index) => `${index + 1}. ${question}`)
      .join("\n");
    return runStructured({
      feature: "answers",
      system: ANSWERS_SYSTEM,
      content: [
        text(jobBlock(input.job)),
        text(resumeText(input.resume)),
        text(profileBlock(input.profile)),
        text(`Answer these application questions for me:\n${questions}`),
      ],
      schema: applicationAnswersSchema,
      ctx,
      maxTokens: 16_000,
    });
  }

  async draftOutreach(
    input: Parameters<AiProvider["draftOutreach"]>[0],
    ctx: Parameters<AiProvider["draftOutreach"]>[1],
  ) {
    const recipient = input.recipient?.name
      ? `The recipient is ${input.recipient.name}${input.recipient.title ? `, ${input.recipient.title}` : ""}.`
      : "I don't know the recipient's name yet.";
    const draft = await runStructured({
      feature: "outreach",
      system: OUTREACH_SYSTEM,
      content: [
        text(jobBlock(input.job)),
        text(resumeText(input.resume)),
        text(profileBlock(input.profile)),
        text(`${recipient} Draft my outreach.`),
      ],
      schema: outreachDraftSchema,
      ctx,
      maxTokens: 16_000,
    });
    return { ...draft, linkedinNote: draft.linkedinNote.slice(0, LINKEDIN_NOTE_LIMIT) };
  }

  async prepareInterview(
    input: Parameters<AiProvider["prepareInterview"]>[0],
    ctx: Parameters<AiProvider["prepareInterview"]>[1],
  ) {
    return runStructured({
      feature: "interview",
      system: INTERVIEW_SYSTEM,
      content: [
        text(jobBlock(input.job)),
        text(resumeText(input.resume)),
        text("Prepare me for interviews."),
      ],
      schema: interviewPrepSchema,
      ctx,
    });
  }

  async *studioChat(
    input: Parameters<AiProvider["studioChat"]>[0],
    ctx: Parameters<AiProvider["studioChat"]>[1],
  ): AsyncGenerator<StudioEvent> {
    const latest: BetaContentBlockParam[] = [];
    if (input.job) latest.push(text(jobBlock(input.job)));
    if (input.profile) latest.push(text(profileBlock(input.profile)));
    latest.push(text(resumeJson(input.resume, "current_resume")), text(input.message));

    let reply = "";
    let message: BetaMessage;
    try {
      const stream = getAnthropic().beta.messages.stream(
        {
          model: configuredModel(),
          max_tokens: 64_000,
          ...FALLBACK_PARAMS,
          betas: [...FALLBACK_PARAMS.betas],
          thinking: { type: "adaptive" },
          output_config: { effort: FEATURE_EFFORT.studio },
          system: [{ type: "text", text: STUDIO_SYSTEM, cache_control: { type: "ephemeral" } }],
          tools: [UPDATE_RESUME_TOOL],
          tool_choice: { type: "auto" },
          messages: [...historyToMessages(input.history), { role: "user", content: latest }],
        },
        { signal: ctx.signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          reply += event.delta.text;
          yield { type: "text", text: event.delta.text };
        }
      }
      message = await stream.finalMessage();
    } catch (error) {
      if (error instanceof Anthropic.APIError || ctx.signal?.aborted) {
        yield { type: "error", message: mapAnthropicError(error).message };
      } else {
        // With eager input streaming the SDK rejects when a tool input isn't parseable JSON.
        log.warn({ err: error }, "studio tool input could not be parsed");
        yield { type: "error", message: "I couldn't apply that edit. Please try again." };
      }
      return;
    }

    await recordUsage("studio", message, ctx);

    try {
      assertUsable(message);
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : "Request declined.",
      };
      return;
    }

    let resume = input.resume;
    let changed = false;
    for (const block of message.content) {
      if (block.type !== "tool_use" || block.name !== UPDATE_RESUME_TOOL.name) continue;
      // Eager streaming skips server-side validation, so validate before applying.
      const parsed = resumeChangesSchema.safeParse(block.input);
      if (!parsed.success) {
        log.warn({ issues: parsed.error.issues.slice(0, 5) }, "studio edit failed validation");
        yield { type: "error", message: "I couldn't apply that edit. Please try again." };
        return;
      }
      resume = applyResumeChanges(resume, parsed.data);
      changed = true;
      yield { type: "resume", resume, summary: parsed.data.change_summary };
    }

    const finalReply =
      (reply || textOf(message)).trim() || (changed ? "Done — I've updated your resume." : "");
    yield { type: "done", reply: finalReply, changed };
  }
}
