import { AiRefusalError, ExternalServiceError } from "@gettargetrole/core/errors";
import { createLogger } from "@gettargetrole/core/logger";
import { AnthropicProvider } from "./anthropic-provider";
import { vendorOf, type AiFeature, type AiVendor } from "./config";
import { ModelUnavailableError } from "./errors";
import { getMeta, isTrainingModel } from "./meta";
import { getOpenAI, OpenAIProvider } from "./openai-provider";
import type { AiCallContext, AiProvider, StudioEvent } from "./types";
import verifiedRoutes from "./verified-routes.json" with { type: "json" };

const log = createLogger("ai-routing");

export interface Route {
  vendor: AiVendor;
  model: string;
}

/**
 * Per feature, the models that passed the latest quality check, cheapest first, as
 * `vendor:model`. The check (`packages/ai/eval`) writes `verified-routes.json`.
 */
export type VerifiedRoutes = Partial<Record<AiFeature, string[]>>;

/** Which of the optional vendors have an API key. Claude is always taken to be set up. */
export type Vendors = Partial<Record<Exclude<AiVendor, "anthropic">, boolean>>;

export function configuredVendors(env: NodeJS.ProcessEnv = process.env): Vendors {
  return { openai: Boolean(env.OPENAI_API_KEY), meta: Boolean(env.META_API_KEY) };
}

/** The quality check's reference: the bar every cheaper model had to match. */
const REFERENCE_MODEL = "claude-sonnet-5";

/**
 * Which model handles a feature until the verified list names others: the cheapest model that
 * matched the reference (Claude Sonnet 5) in the quality check, `packages/ai/eval` (results in
 * docs/ARCHITECTURE.md). Where no other model matched it, the feature runs on the reference itself.
 */
export const DEFAULT_ROUTES: Record<AiFeature, Route> = {
  // Tied the reference on every import (PDF and text) at about 1/30 of the cost.
  import: { vendor: "openai", model: "gpt-4o-mini" },
  // GPT-4o mini gave verdicts that contradicted its own score; Luna passed every check.
  match: { vendor: "openai", model: "gpt-6-luna" },
  // Across 25 profiles, claude-haiku-5-5 failed more fact checks than the reference, and once
  // claimed experience the resume doesn't show.
  tailor: { vendor: "anthropic", model: REFERENCE_MODEL },
  // Both judges still preferred the reference's cover letters.
  cover_letter: { vendor: "anthropic", model: REFERENCE_MODEL },
  // The same price as the reference, and both judges preferred its answers.
  answers: { vendor: "anthropic", model: "claude-sonnet-5-5" },
  interview: { vendor: "anthropic", model: REFERENCE_MODEL },
  // Not judged yet, so it stays on the reference.
  generate: { vendor: "anthropic", model: REFERENCE_MODEL },
  // Both judges rated it at least as good as the reference, at about 1/9 of the cost.
  outreach: { vendor: "anthropic", model: "claude-haiku-5-5" },
  // Judges preferred the reference when the Studio was asked to tailor a resume.
  studio: { vendor: "anthropic", model: REFERENCE_MODEL },
  // Bulk extraction across every post: on 50 real posts it kept the most facts, and every fact
  // that passed the quote check matched GPT-4.1 (packages/ai/eval/enrich.mts).
  enrich: { vendor: "openai", model: "gpt-4o-mini" },
};

/** The Claude model that ends a feature's chain, so there's always somewhere left to go. */
export const CLAUDE_FALLBACK: Record<AiFeature, string> = {
  // Claude Haiku 4.5 also matched the reference on imports; Haiku 5.5 on fit analysis.
  import: "claude-haiku-4-5",
  match: "claude-haiku-5-5",
  tailor: REFERENCE_MODEL,
  cover_letter: REFERENCE_MODEL,
  answers: REFERENCE_MODEL,
  interview: REFERENCE_MODEL,
  generate: REFERENCE_MODEL,
  outreach: REFERENCE_MODEL,
  studio: REFERENCE_MODEL,
  enrich: "claude-haiku-4-5",
};

const isVendor = (value: string): value is AiVendor =>
  value === "anthropic" || value === "openai" || value === "meta";

/**
 * Parses a route like `openai:gpt-6-luna`, `meta:muse-ember-1.0` or `claude-sonnet-5`. Null for
 * anything else, and for models that let their vendor train on what they're sent.
 */
export function parseRoute(value: string): Route | null {
  const [first, second] = value.trim().split(":", 2);
  if (!first) return null;
  let route: Route | null = null;
  if (second === undefined) route = { vendor: vendorOf(first), model: first };
  else if (isVendor(first) && second) route = { vendor: first, model: second };
  return route && !isTrainingModel(route.model) ? route : null;
}

const keyOf = (route: Route) => `${route.vendor}:${route.model}`;

const claudeFallback = (feature: AiFeature): Route => ({
  vendor: "anthropic",
  model: CLAUDE_FALLBACK[feature],
});

/**
 * The models a feature tries, in order. `AI_ROUTE_<FEATURE>` (e.g.
 * `AI_ROUTE_TAILOR=openai:gpt-6-luna`) pins one feature and `AI_MODEL` puts every feature on one
 * Claude model; otherwise the verified list applies, or the default until a check has run. The
 * feature's Claude fallback comes last, except after a pinned Claude model.
 */
export function routeChain(
  feature: AiFeature,
  env: NodeJS.ProcessEnv = process.env,
  verified: VerifiedRoutes = verifiedRoutes as VerifiedRoutes,
): Route[] {
  const override = env[`AI_ROUTE_${feature.toUpperCase()}`];
  const pinned: Route | null =
    (override ? parseRoute(override) : null) ??
    (env.AI_MODEL ? { vendor: "anthropic", model: env.AI_MODEL } : null);
  if (pinned?.vendor === "anthropic") return [pinned];

  const listed = (verified[feature] ?? []).flatMap((entry) => parseRoute(entry) ?? []);
  const preferred = pinned ? [pinned] : listed.length > 0 ? listed : [DEFAULT_ROUTES[feature]];
  const chain = [...preferred, claudeFallback(feature)];
  return [...new Map(chain.map((route) => [keyOf(route), route])).values()];
}

/** The model a feature uses first. */
export function routeFor(feature: AiFeature, env: NodeJS.ProcessEnv = process.env): Route {
  return routeChain(feature, env)[0]!;
}

/** The routes whose vendor has a key; if none does, the feature's Claude fallback. */
export function usableRoutes(chain: Route[], feature: AiFeature, vendors: Vendors): Route[] {
  const usable = chain.filter((route) => route.vendor === "anthropic" || vendors[route.vendor]);
  return usable.length > 0 ? usable : [claudeFallback(feature)];
}

/** The Claude model for a feature: its route's model, or its fallback when routed elsewhere. */
export function claudeModelFor(route: Route, feature: AiFeature): string {
  return route.vendor === "anthropic" ? route.model : CLAUDE_FALLBACK[feature];
}

/** Errors that mean "try the same request on another model": outages, limits, bad output, refusals. */
function shouldFallBack(error: unknown): boolean {
  return error instanceof ExternalServiceError || error instanceof AiRefusalError;
}

function createProvider(route: Route): AiProvider {
  if (route.vendor === "anthropic") return new AnthropicProvider(() => route.model);
  return new OpenAIProvider(() => route.model, route.vendor === "meta" ? getMeta : getOpenAI);
}

/** How long auto mode puts off using a model after its API fails. */
const REST_MS = 60_000;

/**
 * Auto mode: each feature runs on the first model in its chain. When a call fails, the same
 * request goes to the next, so users see a result rather than an error. A model whose API is
 * unavailable is rested for a minute: it's tried only after the others.
 */
export class RoutedProvider implements AiProvider {
  readonly name = "routed" as const;
  private readonly vendors: Vendors;
  private readonly create: (route: Route) => AiProvider;
  private readonly now: () => number;
  private readonly providers = new Map<string, AiProvider>();
  private readonly restingUntil = new Map<string, number>();

  constructor(
    private readonly chain: (feature: AiFeature) => Route[] = (feature) => routeChain(feature),
    options: {
      vendors?: Vendors;
      providerFor?: (route: Route) => AiProvider;
      now?: () => number;
    } = {},
  ) {
    this.vendors = options.vendors ?? {};
    this.create = options.providerFor ?? createProvider;
    this.now = options.now ?? Date.now;
  }

  /** The feature's usable routes in the order to try them: resting models go last. */
  private order(feature: AiFeature): Route[] {
    const routes = usableRoutes(this.chain(feature), feature, this.vendors);
    const resting = (route: Route) => (this.restingUntil.get(keyOf(route)) ?? 0) > this.now();
    return [...routes.filter((route) => !resting(route)), ...routes.filter(resting)];
  }

  private provider(route: Route): AiProvider {
    let provider = this.providers.get(keyOf(route));
    if (!provider) {
      provider = this.create(route);
      this.providers.set(keyOf(route), provider);
    }
    return provider;
  }

  private rest(route: Route): void {
    this.restingUntil.set(keyOf(route), this.now() + REST_MS);
  }

  modelFor(feature: AiFeature): string {
    return this.order(feature)[0]!.model;
  }

  private async call<R>(
    feature: AiFeature,
    ctx: AiCallContext,
    run: (provider: AiProvider) => Promise<R>,
  ): Promise<R> {
    const routes = this.order(feature);
    for (let index = 0; ; index += 1) {
      const route = routes[index]!;
      try {
        return await run(this.provider(route));
      } catch (error) {
        if (error instanceof ModelUnavailableError) this.rest(route);
        const last = index === routes.length - 1;
        if (last || ctx.signal?.aborted || !shouldFallBack(error)) throw error;
        log.warn(
          { feature, model: route.model, err: error },
          "AI model failed; trying the next one",
        );
      }
    }
  }

  importResume(...[source, ctx]: Parameters<AiProvider["importResume"]>) {
    return this.call("import", ctx, (provider) => provider.importResume(source, ctx));
  }

  generateResume(...[input, ctx]: Parameters<AiProvider["generateResume"]>) {
    return this.call("generate", ctx, (provider) => provider.generateResume(input, ctx));
  }

  tailorResume(...[input, ctx]: Parameters<AiProvider["tailorResume"]>) {
    return this.call("tailor", ctx, (provider) => provider.tailorResume(input, ctx));
  }

  analyzeFit(...[input, ctx]: Parameters<AiProvider["analyzeFit"]>) {
    return this.call("match", ctx, (provider) => provider.analyzeFit(input, ctx));
  }

  writeCoverLetter(...[input, ctx]: Parameters<AiProvider["writeCoverLetter"]>) {
    return this.call("cover_letter", ctx, (provider) => provider.writeCoverLetter(input, ctx));
  }

  answerQuestions(...[input, ctx]: Parameters<AiProvider["answerQuestions"]>) {
    return this.call("answers", ctx, (provider) => provider.answerQuestions(input, ctx));
  }

  draftOutreach(...[input, ctx]: Parameters<AiProvider["draftOutreach"]>) {
    return this.call("outreach", ctx, (provider) => provider.draftOutreach(input, ctx));
  }

  prepareInterview(...[input, ctx]: Parameters<AiProvider["prepareInterview"]>) {
    return this.call("interview", ctx, (provider) => provider.prepareInterview(input, ctx));
  }

  async *studioChat(
    input: Parameters<AiProvider["studioChat"]>[0],
    ctx: AiCallContext,
  ): AsyncGenerator<StudioEvent> {
    const routes = this.order("studio");
    for (const [index, route] of routes.entries()) {
      // Move on only if a turn fails before anything reached the user.
      let started = false;
      let moveOn = false;
      for await (const event of this.provider(route).studioChat(input, ctx)) {
        if (event.type !== "error") {
          started = true;
          yield event;
          continue;
        }
        if (event.unavailable) this.rest(route);
        if (!started && index < routes.length - 1 && !ctx.signal?.aborted) {
          log.warn(
            { model: route.model, message: event.message },
            "AI studio turn failed; trying the next model",
          );
          moveOn = true;
          break;
        }
        yield { type: "error", message: event.message };
      }
      if (!moveOn) return;
    }
  }
}
