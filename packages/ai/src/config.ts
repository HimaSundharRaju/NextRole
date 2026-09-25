export type AiFeature =
  | "import"
  | "generate"
  | "tailor"
  | "match"
  | "cover_letter"
  | "answers"
  | "outreach"
  | "interview"
  | "studio";

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
};

export const DEFAULT_MODEL = "claude-opus-5";

export function configuredModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
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
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Estimated cost in micro-dollars (1e-6 USD). Unknown models are priced like Opus 5. */
export function estimateCostMicroUsd(model: string, tokens: TokenCounts): number {
  const price = PRICING[model] ?? PRICING[DEFAULT_MODEL]!;
  const usd =
    (tokens.inputTokens * price.input +
      tokens.cacheReadTokens * price.input * CACHE_READ_MULTIPLIER +
      tokens.cacheWriteTokens * price.input * CACHE_WRITE_MULTIPLIER +
      tokens.outputTokens * price.output) /
    1_000_000;
  return Math.round(usd * 1_000_000);
}
