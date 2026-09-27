export type AiFeature =
  | "import"
  | "generate"
  | "tailor"
  | "match"
  | "cover_letter"
  | "answers"
  | "outreach"
  | "interview"
  | "studio"
  /** Background: facts for the job board's filters, read from postings (no user attached). */
  | "enrich";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Effort per feature. Interactive and extraction work runs at `medium` (fast, and strong on
 * Claude Opus 5); writing that is judged on quality (tailoring, generation) runs at `high`.
 */
export const FEATURE_EFFORT: Record<AiFeature, Effort> = {
  import: "medium",
  generate: "high",
  tailor: "high",
  match: "medium",
  cover_letter: "medium",
  answers: "medium",
  outreach: "medium",
  interview: "medium",
  studio: "medium",
  enrich: "low",
};

export const DEFAULT_MODEL = "claude-opus-5";

export function configuredModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

/**
 * The model without its snapshot date: `claude-haiku-4-5-20251001` → `claude-haiku-4-5`,
 * `gpt-4o-mini-2024-07-18` → `gpt-4o-mini`.
 */
export function baseModelId(model: string): string {
  return model.replace(/-\d{8}$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

export type AiVendor = "anthropic" | "openai";

/** Which API serves a model: Claude models are Anthropic's, GPT and o-series models OpenAI's. */
export function vendorOf(model: string): AiVendor {
  return model.startsWith("claude") ? "anthropic" : "openai";
}

/** Claude 4.5 and earlier (Haiku 4.5, Sonnet 4.5, ...): no adaptive thinking or effort. */
const PRE_ADAPTIVE_MODEL = /^claude-(?:3-|(?:opus|sonnet|haiku)-4(?:-[015])?$)/;

/** Models whose safety classifiers can decline a request, which the API can retry elsewhere. */
const REFUSAL_FALLBACK_MODELS = new Set([
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-fable-5",
  "claude-fable-5-1",
]);

/** Models that reject a forced tool choice (`tool_choice` of type "tool" or "any"). */
const NO_FORCED_TOOL_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-1", "claude-mythos-5-1"]);

export interface ModelCapabilities {
  /** Adaptive thinking and the effort setting, which the API rejects before Claude 4.6. */
  adaptiveThinking: boolean;
  /** Server-side refusal fallbacks (`fallbacks: "default"`). */
  refusalFallbacks: boolean;
  /** Whether a request can require a specific tool call. */
  forcedToolChoice: boolean;
}

export function modelCapabilities(model: string): ModelCapabilities {
  const id = baseModelId(model);
  return {
    adaptiveThinking: !PRE_ADAPTIVE_MODEL.test(id),
    refusalFallbacks: REFUSAL_FALLBACK_MODELS.has(id),
    forcedToolChoice: !NO_FORCED_TOOL_MODELS.has(id),
  };
}

/** USD per million tokens (first-party API list prices). */
interface ModelPricing {
  input: number;
  output: number;
}

const PRICING: Record<string, ModelPricing> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * OpenAI list prices, USD per million tokens. OpenAI prices cached input on its own and has no
 * cache-write charge.
 */
const OPENAI_PRICING: Record<string, ModelPricing & { cachedInput: number }> = {
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.1": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cachedInput: 0.025, output: 0.4 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
};

const CACHE_READ_MULTIPLIER = 0.1;
/** Writing a 5-minute cache entry costs 1.25× the input price; a 1-hour entry costs 2×. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;
/** Both vendors' batch APIs charge half the list price for every token type. */
const BATCH_MULTIPLIER = 0.5;

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** The part of `cacheWriteTokens` written with the 1-hour TTL. */
  cacheWrite1hTokens?: number;
}

/**
 * Estimated cost in micro-dollars (1e-6 USD). `inputTokens` excludes cached reads. Unknown models
 * are priced like Opus 5. `batch` applies the batch discount.
 */
export function estimateCostMicroUsd(
  model: string,
  tokens: TokenCounts,
  options: { batch?: boolean } = {},
): number {
  const discount = options.batch ? BATCH_MULTIPLIER : 1;
  const openai = OPENAI_PRICING[baseModelId(model)];
  if (openai) {
    const usd =
      (tokens.inputTokens * openai.input +
        tokens.cacheReadTokens * openai.cachedInput +
        tokens.outputTokens * openai.output) /
      1_000_000;
    return Math.round(usd * discount * 1_000_000);
  }
  const price = PRICING[baseModelId(model)] ?? PRICING[DEFAULT_MODEL]!;
  const longWrites = Math.min(tokens.cacheWrite1hTokens ?? 0, tokens.cacheWriteTokens);
  const usd =
    (tokens.inputTokens * price.input +
      tokens.cacheReadTokens * price.input * CACHE_READ_MULTIPLIER +
      (tokens.cacheWriteTokens - longWrites) * price.input * CACHE_WRITE_MULTIPLIER +
      longWrites * price.input * CACHE_WRITE_1H_MULTIPLIER +
      tokens.outputTokens * price.output) /
    1_000_000;
  return Math.round(usd * discount * 1_000_000);
}
