import Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTextBlockParam,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { createLogger } from "@gettargetrole/core/logger";
import { z } from "zod";
import {
  assertUsable,
  cacheable,
  getAnthropic,
  mapAnthropicError,
  modelParams,
  recordUsage,
  runStructured,
  textOf,
} from "./client";
import { configuredModel, type AiFeature } from "./config";
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
import type { AiCallContext, AiProvider, ChatTurn, StudioEvent } from "./types";

const log = createLogger("ai-studio");

const text = (value: string): BetaTextBlockParam => ({ type: "text", text: value });

function toBlock(part: RequestPart): BetaContentBlockParam {
  return part.type === "text"
    ? text(part.text)
    : {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: part.data.toString("base64"),
        },
        title: part.fileName,
      };
}

export const UPDATE_RESUME_TOOL: BetaTool = {
  name: "update_resume",
  description:
    "Apply edits to the user's resume, which is shown live next to the chat. Set every section you are not changing to null. A non-null section replaces that entire section, so include all of its entries.",
  input_schema: transformJSONSchema(
    z.toJSONSchema(resumeChangesSchema),
  ) as BetaTool["input_schema"],
  // Not strict: the API compiles strict schemas into a grammar and rejects this one, with its
  // eight nullable resume sections, as too large. studioChat validates every input instead.
  eager_input_streaming: true,
};

/**
 * The recent conversation (see `recentHistory`), with a cache breakpoint on its last turn so the
 * next message reads the earlier turns from the prompt cache.
 */
function historyToMessages(history: ChatTurn[]): BetaMessageParam[] {
  const turns = recentHistory(history);
  return turns.map((turn, index) => ({
    role: turn.role,
    content:
      index === turns.length - 1 && turn.content ? cacheable([text(turn.content)]) : turn.content,
  }));
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;

  /** `modelOf` picks the Claude model per feature; by default every feature uses AI_MODEL. */
  constructor(private readonly modelOf: (feature: AiFeature) => string = () => configuredModel()) {}

  modelFor(feature: AiFeature): string {
    return this.modelOf(feature);
  }

  private async run<Output, Result>(
    request: FeatureRequest<Output, Result>,
    ctx: AiCallContext,
  ): Promise<Result> {
    const output = await runStructured({
      feature: request.feature,
      model: this.modelFor(request.feature),
      system: request.system,
      stable: request.stable.map(text),
      content: request.content.map(toBlock),
      schema: request.schema,
      viaTool: request.viaTool,
      maxTokens: request.maxTokens,
      ctx,
    });
    return request.finish(output);
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
    input: Parameters<AiProvider["studioChat"]>[0],
    ctx: Parameters<AiProvider["studioChat"]>[1],
  ): AsyncGenerator<StudioEvent> {
    const latest = studioTurnParts(input).map(text);

    let reply = "";
    let message: BetaMessage;
    const model = this.modelFor("studio");
    try {
      const stream = getAnthropic().beta.messages.stream(
        {
          model,
          // The ceiling for Claude Haiku 4.5; newer models allow more.
          max_tokens: 64_000,
          ...modelParams(model, "studio"),
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
