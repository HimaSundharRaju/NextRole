import { AiRefusalError, ExternalServiceError } from "@gettargetrole/core/errors";
import { createLogger } from "@gettargetrole/core/logger";
import { AnthropicProvider } from "./anthropic-provider";
import type { AiFeature, AiVendor } from "./config";
import { OpenAIProvider } from "./openai-provider";
import type { AiCallContext, AiProvider, StudioEvent } from "./types";

const log = createLogger("ai-routing");

export interface Route {
  vendor: AiVendor;
  model: string;
}

/** The quality check's reference: the bar every cheaper model had to match. */
const REFERENCE_MODEL = "claude-sonnet-5";

/**
 * Which model handles each feature by default: the cheapest model that matched the reference
 * (Claude Sonnet 5) in the quality check, `packages/ai/eval` (results in docs/ARCHITECTURE.md).
 * Where no cheaper model matched it, the feature runs on the reference itself.
 */
export const DEFAULT_ROUTES: Record<AiFeature, Route> = {
  // Tied the reference on every import (PDF and text) at about 1/30 of the cost.
  import: { vendor: "openai", model: "gpt-4o-mini" },
  // Judged as good as or better than the reference in most comparisons, at about 1/30 of the cost.
  match: { vendor: "openai", model: "gpt-4o-mini" },
  // Every cheaper model added skills the candidate doesn't have far more often.
  tailor: { vendor: "anthropic", model: REFERENCE_MODEL },
  // Both judges preferred the reference's letters, answers and interview prep.
  cover_letter: { vendor: "anthropic", model: REFERENCE_MODEL },
  answers: { vendor: "anthropic", model: REFERENCE_MODEL },
  interview: { vendor: "anthropic", model: REFERENCE_MODEL },
  // Not judged yet, so they stay on the reference.
  generate: { vendor: "anthropic", model: REFERENCE_MODEL },
  outreach: { vendor: "anthropic", model: REFERENCE_MODEL },
  studio: { vendor: "anthropic", model: REFERENCE_MODEL },
};

/** The Claude model a feature uses when its OpenAI route fails or OpenAI isn't configured. */
export const CLAUDE_FALLBACK: Record<AiFeature, string> = {
  // Claude Haiku 4.5 also matched the reference on these two.
  import: "claude-haiku-4-5",
  match: "claude-haiku-4-5",
  tailor: REFERENCE_MODEL,
  cover_letter: REFERENCE_MODEL,
  answers: REFERENCE_MODEL,
  interview: REFERENCE_MODEL,
  generate: REFERENCE_MODEL,
  outreach: REFERENCE_MODEL,
  studio: REFERENCE_MODEL,
};

/** Parses an override like `openai:gpt-5-mini`, `anthropic:claude-sonnet-5` or `claude-sonnet-5`. */
export function parseRoute(value: string): Route | null {
  const [first, second] = value.trim().split(":", 2);
  if (!first) return null;
  if (second === undefined) {
    return { vendor: first.startsWith("claude") ? "anthropic" : "openai", model: first };
  }
  if ((first === "anthropic" || first === "openai") && second) {
    return { vendor: first, model: second };
  }
  return null;
}

/**
 * The route for a feature. `AI_ROUTE_<FEATURE>` (e.g. `AI_ROUTE_TAILOR=openai:gpt-5-mini`)
 * overrides one feature; `AI_MODEL` puts every feature on one Claude model; otherwise the
 * defaults apply.
 */
export function routeFor(feature: AiFeature, env: NodeJS.ProcessEnv = process.env): Route {
  const override = env[`AI_ROUTE_${feature.toUpperCase()}`];
  const parsed = override ? parseRoute(override) : null;
  if (parsed) return parsed;
  if (env.AI_MODEL) return { vendor: "anthropic", model: env.AI_MODEL };
  return DEFAULT_ROUTES[feature];
}

/** The route a feature takes: without OpenAI configured, its OpenAI route runs on Claude. */
export function effectiveRoute(route: Route, feature: AiFeature, openai: boolean): Route {
  return route.vendor === "openai" && !openai
    ? { vendor: "anthropic", model: CLAUDE_FALLBACK[feature] }
    : route;
}

/** The Claude model for a feature: its route's model, or its fallback when routed to OpenAI. */
export function claudeModelFor(route: Route, feature: AiFeature): string {
  return route.vendor === "anthropic" ? route.model : CLAUDE_FALLBACK[feature];
}

/** Errors that mean "try the same request on Claude": outages, limits, bad output, refusals. */
function shouldFallBack(error: unknown): boolean {
  return error instanceof ExternalServiceError || error instanceof AiRefusalError;
}

/**
 * Sends each feature to its routed model, Claude or OpenAI. When an OpenAI call fails, the same
 * request runs on the feature's Claude fallback, so users see a result rather than an error.
 */
export class RoutedProvider implements AiProvider {
  readonly name = "routed" as const;
  private readonly anthropic: AnthropicProvider;
  private readonly openai: OpenAIProvider | null;

  constructor(
    private readonly routes: (feature: AiFeature) => Route = (feature) => routeFor(feature),
    options: {
      openai?: boolean;
      anthropic?: AnthropicProvider;
      openaiProvider?: OpenAIProvider;
    } = {},
  ) {
    this.anthropic =
      options.anthropic ??
      new AnthropicProvider((feature) => claudeModelFor(this.routes(feature), feature));
    this.openai =
      options.openaiProvider ??
      (options.openai ? new OpenAIProvider((feature) => this.routes(feature).model) : null);
  }

  private route(feature: AiFeature): Route {
    return effectiveRoute(this.routes(feature), feature, Boolean(this.openai));
  }

  modelFor(feature: AiFeature): string {
    return this.route(feature).model;
  }

  private async call<R>(feature: AiFeature, run: (provider: AiProvider) => Promise<R>): Promise<R> {
    if (this.route(feature).vendor === "anthropic") return run(this.anthropic);
    try {
      return await run(this.openai!);
    } catch (error) {
      if (!shouldFallBack(error)) throw error;
      log.warn({ feature, err: error }, "OpenAI route failed; retrying on Claude");
      return run(this.anthropic);
    }
  }

  importResume(...[source, ctx]: Parameters<AiProvider["importResume"]>) {
    return this.call("import", (provider) => provider.importResume(source, ctx));
  }

  generateResume(...[input, ctx]: Parameters<AiProvider["generateResume"]>) {
    return this.call("generate", (provider) => provider.generateResume(input, ctx));
  }

  tailorResume(...[input, ctx]: Parameters<AiProvider["tailorResume"]>) {
    return this.call("tailor", (provider) => provider.tailorResume(input, ctx));
  }

  analyzeFit(...[input, ctx]: Parameters<AiProvider["analyzeFit"]>) {
    return this.call("match", (provider) => provider.analyzeFit(input, ctx));
  }

  writeCoverLetter(...[input, ctx]: Parameters<AiProvider["writeCoverLetter"]>) {
    return this.call("cover_letter", (provider) => provider.writeCoverLetter(input, ctx));
  }

  answerQuestions(...[input, ctx]: Parameters<AiProvider["answerQuestions"]>) {
    return this.call("answers", (provider) => provider.answerQuestions(input, ctx));
  }

  draftOutreach(...[input, ctx]: Parameters<AiProvider["draftOutreach"]>) {
    return this.call("outreach", (provider) => provider.draftOutreach(input, ctx));
  }

  prepareInterview(...[input, ctx]: Parameters<AiProvider["prepareInterview"]>) {
    return this.call("interview", (provider) => provider.prepareInterview(input, ctx));
  }

  async *studioChat(
    input: Parameters<AiProvider["studioChat"]>[0],
    ctx: AiCallContext,
  ): AsyncGenerator<StudioEvent> {
    if (this.route("studio").vendor === "anthropic") {
      yield* this.anthropic.studioChat(input, ctx);
      return;
    }
    // Fall back to Claude only if OpenAI fails before anything reached the user.
    let started = false;
    for await (const event of this.openai!.studioChat(input, ctx)) {
      if (event.type === "error" && !started && !ctx.signal?.aborted) {
        log.warn({ message: event.message }, "OpenAI studio turn failed; retrying on Claude");
        yield* this.anthropic.studioChat(input, ctx);
        return;
      }
      started = true;
      yield event;
    }
  }
}
