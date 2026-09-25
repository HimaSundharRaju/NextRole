import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaTool,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AiRefusalError, ExternalServiceError } from "@gettargetrole/core/errors";
import { createLogger } from "@gettargetrole/core/logger";
import { z } from "zod";
import {
  configuredModel,
  estimateCostMicroUsd,
  FEATURE_EFFORT,
  modelCapabilities,
  type AiFeature,
} from "./config";
import type { AiCallContext, UsageRecord } from "./types";

const log = createLogger("ai");

/**
 * Server-side refusal fallbacks: if Claude's safety classifiers decline a request (for example a
 * false positive on a security-engineering resume), the API re-runs it on Anthropic's recommended
 * fallback model inside the same call instead of failing.
 */
export const FALLBACK_PARAMS = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
} as const;

/**
 * Request fields that depend on the model: adaptive thinking at the feature's effort level
 * (Claude 4.6 and later; older models such as Claude Haiku 4.5 reject both) and refusal
 * fallbacks (only models whose safety classifiers can decline a request).
 */
export function modelParams(model: string, feature: AiFeature) {
  const { adaptiveThinking, refusalFallbacks } = modelCapabilities(model);
  return {
    ...(refusalFallbacks
      ? { betas: [...FALLBACK_PARAMS.betas], fallbacks: FALLBACK_PARAMS.fallbacks }
      : {}),
    ...(adaptiveThinking
      ? {
          thinking: { type: "adaptive" as const },
          output_config: { effort: FEATURE_EFFORT[feature] },
        }
      : {}),
  };
}

let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({ maxRetries: 2, timeout: 5 * 60_000 });
  }
  return client;
}

export function usageFrom(feature: AiFeature, message: BetaMessage): UsageRecord {
  const iterations = message.usage.iterations ?? [];
  const attempts = iterations.filter(
    (entry): entry is Extract<typeof entry, { type: "message" | "fallback_message" }> =>
      entry.type === "message" || entry.type === "fallback_message",
  );
  // With fallbacks, top-level usage covers only the attempt that produced the message.
  const sources =
    attempts.length > 0
      ? attempts.map((entry) => ({
          model: entry.model ?? message.model,
          inputTokens: entry.input_tokens,
          outputTokens: entry.output_tokens,
          cacheReadTokens: entry.cache_read_input_tokens ?? 0,
          cacheWriteTokens: entry.cache_creation_input_tokens ?? 0,
        }))
      : [
          {
            model: message.model,
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
          },
        ];
  return sources.reduce<UsageRecord>(
    (total, part) => ({
      feature,
      model: message.model,
      inputTokens: total.inputTokens + part.inputTokens,
      outputTokens: total.outputTokens + part.outputTokens,
      cacheReadTokens: total.cacheReadTokens + part.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + part.cacheWriteTokens,
      costMicroUsd: total.costMicroUsd + estimateCostMicroUsd(part.model, part),
    }),
    {
      feature,
      model: message.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicroUsd: 0,
    },
  );
}

export async function recordUsage(
  feature: AiFeature,
  message: BetaMessage,
  ctx: AiCallContext,
): Promise<void> {
  const usage = usageFrom(feature, message);
  log.info(
    {
      feature,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      stopReason: message.stop_reason,
    },
    "claude call",
  );
  try {
    await ctx.onUsage?.(usage);
  } catch (error) {
    log.error({ err: error }, "failed to record AI usage");
  }
}

/** Stop reasons that mean the content can't be used as-is. Check before reading content. */
export function assertUsable(message: BetaMessage): void {
  if (message.stop_reason === "refusal") {
    log.warn({ category: message.stop_details?.category ?? null }, "claude refused request");
    throw new AiRefusalError();
  }
  if (message.stop_reason === "max_tokens") {
    throw new ExternalServiceError(
      "The AI service",
      "The AI response was too long and got cut off. Please try again.",
    );
  }
}

export function textOf(message: BetaMessage): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Converts SDK errors into user-safe application errors; rethrows anything already mapped. */
export function mapAnthropicError(error: unknown): Error {
  if (error instanceof Anthropic.RateLimitError) {
    return new ExternalServiceError(
      "The AI service",
      "The AI service is busy right now. Please try again in a minute.",
    );
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    log.error({ err: error }, "Anthropic credentials rejected");
    return new ExternalServiceError(
      "The AI service",
      "The AI service is not configured correctly. Please contact support.",
    );
  }
  if (error instanceof Anthropic.BadRequestError) {
    log.error({ err: error }, "Anthropic rejected the request");
    return new ExternalServiceError(
      "The AI service",
      "The AI couldn't process this request. Please try different input.",
    );
  }
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new ExternalServiceError("The AI service");
  }
  if (error instanceof Anthropic.APIError) {
    log.error({ err: error, status: error.status }, "Anthropic API error");
    return new ExternalServiceError("The AI service");
  }
  return error instanceof Error ? error : new Error(String(error));
}

export interface StructuredCall<S extends z.ZodType> {
  feature: AiFeature;
  system: string;
  content: BetaContentBlockParam[];
  schema: S;
  ctx: AiCallContext;
  maxTokens?: number;
  /**
   * Deliver the result as a call to a non-strict tool instead of as a structured output. For
   * schemas too large for structured outputs, which the API compiles into a grammar and rejects
   * when it gets too big ("The compiled grammar is too large"). The result is validated against
   * `schema` either way.
   */
  viaTool?: boolean;
}

/** The tool that carries the result of a `viaTool` call. */
export const RESULT_TOOL_NAME = "submit_result";

function resultTool(schema: z.ZodType): BetaTool {
  // Not eager: nothing reads the input before it's complete, and buffering it lets the API
  // check that it is valid JSON.
  return {
    name: RESULT_TOOL_NAME,
    description: "Submit the finished result.",
    input_schema: transformJSONSchema(z.toJSONSchema(schema)) as BetaTool["input_schema"],
  };
}

/**
 * One Claude call that must return JSON matching `schema`, as a structured output or, with
 * `viaTool`, a tool call. Streams under the hood so large outputs don't hit HTTP timeouts.
 */
export async function runStructured<S extends z.ZodType>(
  call: StructuredCall<S>,
): Promise<z.infer<S>> {
  const model = configuredModel();
  const params = modelParams(model, call.feature);
  const output = call.viaTool
    ? {
        tools: [resultTool(call.schema)],
        // Require the call: with `auto`, a model can answer in text instead. Models that reject a
        // forced choice get `auto`, and the system prompt asks for the call.
        tool_choice: modelCapabilities(model).forcedToolChoice
          ? { type: "tool" as const, name: RESULT_TOOL_NAME }
          : { type: "auto" as const },
      }
    : { output_config: { ...params.output_config, format: betaZodOutputFormat(call.schema) } };
  const system = call.viaTool
    ? `${call.system}\n\nSubmit your result by calling the ${RESULT_TOOL_NAME} tool.`
    : call.system;
  let message: BetaMessage;
  try {
    const stream = getAnthropic().beta.messages.stream(
      {
        model,
        max_tokens: call.maxTokens ?? 32_000,
        ...params,
        ...output,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: call.content }],
      },
      { signal: call.ctx.signal },
    );
    message = await stream.finalMessage();
  } catch (error) {
    throw mapAnthropicError(error);
  }

  await recordUsage(call.feature, message, call.ctx);
  assertUsable(message);

  let json: unknown;
  if (call.viaTool) {
    // Undefined when Claude didn't call the tool, which validation below reports.
    json = message.content.find(
      (block): block is BetaToolUseBlock =>
        block.type === "tool_use" && block.name === RESULT_TOOL_NAME,
    )?.input;
  } else {
    try {
      json = JSON.parse(textOf(message));
    } catch {
      throw new ExternalServiceError(
        "The AI service",
        "The AI returned an unreadable response. Please try again.",
      );
    }
  }
  const parsed = call.schema.safeParse(json);
  if (!parsed.success) {
    log.error(
      { feature: call.feature, issues: parsed.error.issues.slice(0, 5) },
      "structured output failed validation",
    );
    throw new ExternalServiceError(
      "The AI service",
      "The AI returned an incomplete response. Please try again.",
    );
  }
  return parsed.data;
}
