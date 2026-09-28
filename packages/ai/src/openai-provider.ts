import { createHash } from "node:crypto";
import { AiRefusalError, ExternalServiceError } from "@gettargetrole/core/errors";
import { createLogger } from "@gettargetrole/core/logger";
import OpenAI from "openai";
import { zodResponsesFunction, zodTextFormat } from "openai/helpers/zod";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputContent,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";
import { estimateCostMicroUsd, type AiFeature } from "./config";
import { STUDIO_SYSTEM } from "./prompts";
import {
  answersRequest,
  applyResumeChanges,
  coverLetterRequest,
  fitRequest,
  generateRequest,
  importRequest,
  interviewRequest,
  outreachRequest,
  recentHistory,
  studioTurnParts,
  tailorRequest,
  type FeatureRequest,
  type RequestPart,
} from "./requests";
import { resumeChangesSchema } from "./schemas";
import type { AiCallContext, AiProvider, StudioEvent, UsageRecord } from "./types";

const log = createLogger("ai-openai");

let client: OpenAI | undefined;

export function getOpenAI(): OpenAI {
  if (!client) client = new OpenAI({ maxRetries: 2, timeout: 5 * 60_000 });
  return client;
}

/** GPT-5 and o-series models reason and take an effort setting; GPT-4.x models reject it. */
export function isReasoningModel(model: string): boolean {
  return /^(?:gpt-5|o\d)/.test(model);
}

/** Reasoning effort per feature on reasoning models: more for writing judged on quality. */
const FEATURE_EFFORT: Record<AiFeature, ReasoningEffort> = {
  import: "low",
  generate: "medium",
  tailor: "medium",
  match: "low",
  cover_letter: "low",
  answers: "low",
  outreach: "low",
  interview: "low",
  studio: "low",
  enrich: "minimal",
};

const UPDATE_RESUME_FUNCTION = zodResponsesFunction({
  name: "update_resume",
  description:
    "Apply edits to the user's resume, which is shown live next to the chat. Set every section you are not changing to null. A non-null section replaces that entire section, so include all of its entries.",
  parameters: resumeChangesSchema,
});

/**
 * OpenAI groups requests that share a prompt prefix by this key, which raises cache hits for a
 * user's resume. A hash, so OpenAI never sees the account id.
 */
function userKey(userId: string | null): string | undefined {
  return userId ? createHash("sha256").update(userId).digest("hex").slice(0, 32) : undefined;
}

function inputContent(parts: RequestPart[]): ResponseInputContent[] {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "input_text", text: part.text }
      : {
          type: "input_file",
          filename: part.fileName,
          file_data: `data:application/pdf;base64,${part.data.toString("base64")}`,
        },
  );
}

/** Token usage and cost of a response; `batch` prices it at the Batch API discount. */
export function openAiUsage(
  feature: AiFeature,
  model: string,
  response: Response,
  options: { batch?: boolean } = {},
): UsageRecord {
  const usage = response.usage;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const tokens = {
    inputTokens: Math.max(0, (usage?.input_tokens ?? 0) - cached),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
    // Reasoning tokens are part of output_tokens and billed as output.
    outputTokens: usage?.output_tokens ?? 0,
  };
  return {
    feature,
    model,
    ...tokens,
    costMicroUsd: estimateCostMicroUsd(model, tokens, options),
    ...(options.batch ? { batch: true } : {}),
  };
}

/** The text of a response's message output; batch results arrive as raw JSON without it. */
function outputText(response: Response): string {
  return response.output
    .flatMap((item) => (item.type === "message" ? item.content : []))
    .map((content) => (content.type === "output_text" ? content.text : ""))
    .join("");
}

async function recordUsage(record: UsageRecord, ctx: AiCallContext): Promise<void> {
  log.info(
    {
      feature: record.feature,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cacheReadTokens: record.cacheReadTokens,
    },
    "openai call",
  );
  try {
    await ctx.onUsage?.(record);
  } catch (error) {
    log.error({ err: error }, "failed to record AI usage");
  }
}

/** Converts SDK errors into user-safe application errors; rethrows anything already mapped. */
export function mapOpenAIError(error: unknown): Error {
  if (error instanceof OpenAI.RateLimitError) {
    return new ExternalServiceError(
      "The AI service",
      "The AI service is busy right now. Please try again in a minute.",
    );
  }
  if (
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError
  ) {
    log.error({ err: error }, "OpenAI credentials rejected");
    return new ExternalServiceError(
      "The AI service",
      "The AI service is not configured correctly. Please contact support.",
    );
  }
  if (error instanceof OpenAI.BadRequestError) {
    log.error({ err: error }, "OpenAI rejected the request");
    return new ExternalServiceError(
      "The AI service",
      "The AI couldn't process this request. Please try different input.",
    );
  }
  if (error instanceof OpenAI.APIError) {
    log.error({ err: error, status: error.status }, "OpenAI API error");
    return new ExternalServiceError("The AI service");
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** Stops on responses that can't be used as-is: refusals and outputs cut off by the limit. */
function assertUsable(response: Response): void {
  const refused = response.output.some(
    (item) => item.type === "message" && item.content.some((content) => content.type === "refusal"),
  );
  if (refused || response.incomplete_details?.reason === "content_filter") {
    log.warn({ model: response.model }, "openai refused request");
    throw new AiRefusalError();
  }
  if (response.status === "incomplete") {
    throw new ExternalServiceError(
      "The AI service",
      "The AI response was too long and got cut off. Please try again.",
    );
  }
}

/** OpenAI models for the features routed to them. Prompts and schemas match the Claude path. */
export class OpenAIProvider implements AiProvider {
  readonly name = "openai" as const;

  constructor(
    private readonly modelOf: (feature: AiFeature) => string,
    private readonly api: () => OpenAI = getOpenAI,
  ) {}

  modelFor(feature: AiFeature): string {
    return this.modelOf(feature);
  }

  private options(feature: AiFeature, ctx: AiCallContext) {
    const model = this.modelFor(feature);
    const key = userKey(ctx.userId);
    return {
      model,
      // Resumes are personal data: don't keep responses on OpenAI's side.
      store: false,
      ...(isReasoningModel(model) ? { reasoning: { effort: FEATURE_EFFORT[feature] } } : {}),
      ...(key ? { prompt_cache_key: key, safety_identifier: key } : {}),
    };
  }

  /** Validates structured output against the request's schema and finishes it. */
  private finish<Output, Result>(request: FeatureRequest<Output, Result>, output: unknown): Result {
    const parsed = request.schema.safeParse(output);
    if (!parsed.success) {
      log.error(
        { feature: request.feature, issues: parsed.error.issues.slice(0, 5) },
        "structured output failed validation",
      );
      throw new ExternalServiceError(
        "The AI service",
        "The AI returned an incomplete response. Please try again.",
      );
    }
    return request.finish(parsed.data);
  }

  /** The Batch API body for a feature request: the same request a live call sends. */
  batchBody<Output, Result>(
    request: FeatureRequest<Output, Result>,
  ): ResponseCreateParamsNonStreaming {
    // The format without its parse helper, which doesn't survive JSON.
    const { type, name, schema, strict } = zodTextFormat(
      request.strictSchema ?? request.schema,
      "result",
    );
    return {
      ...this.options(request.feature, { userId: null }),
      instructions: request.system,
      input: [
        {
          role: "user",
          content: inputContent([
            ...request.stable.map((text) => ({ type: "text" as const, text })),
            ...request.content,
          ]),
        },
      ],
      text: { format: { type, name, schema, strict } },
      max_output_tokens: request.maxTokens ?? 32_000,
    };
  }

  /** Reads a Batch API response into the feature's result, recording usage at batch price. */
  async readBatchResponse<Output, Result>(
    request: FeatureRequest<Output, Result>,
    response: Response,
    ctx: AiCallContext,
  ): Promise<Result> {
    const model = response.model ?? this.modelFor(request.feature);
    await recordUsage(openAiUsage(request.feature, model, response, { batch: true }), ctx);
    assertUsable(response);
    let output: unknown;
    try {
      output = JSON.parse(outputText(response));
    } catch {
      throw new ExternalServiceError(
        "The AI service",
        "The AI returned an unreadable response. Please try again.",
      );
    }
    return this.finish(request, output);
  }

  private async run<Output, Result>(
    request: FeatureRequest<Output, Result>,
    ctx: AiCallContext,
  ): Promise<Result> {
    const options = this.options(request.feature, ctx);
    let response: Response & { output_parsed: unknown };
    try {
      response = await this.api().responses.parse(
        {
          ...options,
          instructions: request.system,
          // Stable parts (resume, profile) first, so a user's next call shares the prefix.
          input: [
            {
              role: "user",
              content: inputContent([
                ...request.stable.map((text) => ({ type: "text" as const, text })),
                ...request.content,
              ]),
            },
          ],
          text: { format: zodTextFormat(request.strictSchema ?? request.schema, "result") },
          max_output_tokens: request.maxTokens ?? 32_000,
        },
        { signal: ctx.signal },
      );
    } catch (error) {
      if (error instanceof OpenAI.APIError) throw mapOpenAIError(error);
      // The SDK throws when the output isn't valid JSON for the schema.
      log.error({ feature: request.feature, err: error }, "openai output could not be parsed");
      throw new ExternalServiceError(
        "The AI service",
        "The AI returned an incomplete response. Please try again.",
      );
    }
    await recordUsage(openAiUsage(request.feature, options.model, response), ctx);
    assertUsable(response);
    return this.finish(request, response.output_parsed);
  }

  async importResume(...[source, ctx]: Parameters<AiProvider["importResume"]>) {
    return this.run(await importRequest(source), ctx);
  }

  async generateResume(...[input, ctx]: Parameters<AiProvider["generateResume"]>) {
    return this.run(generateRequest(input), ctx);
  }

  async tailorResume(...[input, ctx]: Parameters<AiProvider["tailorResume"]>) {
    return this.run(tailorRequest(input), ctx);
  }

  async analyzeFit(...[input, ctx]: Parameters<AiProvider["analyzeFit"]>) {
    return this.run(fitRequest(input), ctx);
  }

  async writeCoverLetter(...[input, ctx]: Parameters<AiProvider["writeCoverLetter"]>) {
    return this.run(coverLetterRequest(input), ctx);
  }

  async answerQuestions(...[input, ctx]: Parameters<AiProvider["answerQuestions"]>) {
    return this.run(answersRequest(input), ctx);
  }

  async draftOutreach(...[input, ctx]: Parameters<AiProvider["draftOutreach"]>) {
    return this.run(outreachRequest(input), ctx);
  }

  async prepareInterview(...[input, ctx]: Parameters<AiProvider["prepareInterview"]>) {
    return this.run(interviewRequest(input), ctx);
  }

  async *studioChat(
    ...[input, ctx]: Parameters<AiProvider["studioChat"]>
  ): AsyncGenerator<StudioEvent> {
    const options = this.options("studio", ctx);
    const history: ResponseInputItem[] = recentHistory(input.history).map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));
    let reply = "";
    let response: Response;
    try {
      const stream = this.api().responses.stream(
        {
          ...options,
          instructions: STUDIO_SYSTEM,
          input: [
            ...history,
            {
              role: "user",
              content: inputContent(
                studioTurnParts(input).map((text) => ({ type: "text" as const, text })),
              ),
            },
          ],
          tools: [UPDATE_RESUME_FUNCTION],
          tool_choice: "auto",
          max_output_tokens: 32_000,
        },
        { signal: ctx.signal },
      );
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          reply += event.delta;
          yield { type: "text", text: event.delta };
        }
      }
      response = await stream.finalResponse();
    } catch (error) {
      yield { type: "error", message: mapOpenAIError(error).message };
      return;
    }

    await recordUsage(openAiUsage("studio", options.model, response), ctx);
    try {
      assertUsable(response);
    } catch (error) {
      yield {
        type: "error",
        message: error instanceof Error ? error.message : "Request declined.",
      };
      return;
    }

    let resume = input.resume;
    let changed = false;
    for (const item of response.output) {
      if (item.type !== "function_call" || item.name !== UPDATE_RESUME_FUNCTION.name) continue;
      let args: unknown;
      try {
        args = JSON.parse(item.arguments);
      } catch {
        args = undefined;
      }
      const parsed = resumeChangesSchema.safeParse(args);
      if (!parsed.success) {
        log.warn({ issues: parsed.error?.issues.slice(0, 5) }, "studio edit failed validation");
        yield { type: "error", message: "I couldn't apply that edit. Please try again." };
        return;
      }
      resume = applyResumeChanges(resume, parsed.data);
      changed = true;
      yield { type: "resume", resume, summary: parsed.data.change_summary };
    }

    const finalReply =
      (reply || response.output_text).trim() || (changed ? "Done — I've updated your resume." : "");
    yield { type: "done", reply: finalReply, changed };
  }
}
