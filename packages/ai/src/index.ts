import { MockProvider } from "./mock-provider";
import { RoutedProvider } from "./routing";
import type { AiProvider } from "./types";

let provider: AiProvider | undefined;

/**
 * The configured AI provider: each feature on its routed model (Claude, or OpenAI when
 * OPENAI_API_KEY is set), or a deterministic mock in tests.
 */
export function getAi(): AiProvider {
  if (!provider) {
    const useMock = process.env.AI_PROVIDER === "mock";
    if (useMock && process.env.NODE_ENV === "production") {
      throw new Error("AI_PROVIDER=mock is not allowed in production");
    }
    provider = useMock
      ? new MockProvider()
      : new RoutedProvider(undefined, { openai: Boolean(process.env.OPENAI_API_KEY) });
  }
  return provider;
}

/** Test helper. */
export function setAiProvider(next: AiProvider | undefined): void {
  provider = next;
}

export { AnthropicProvider, UPDATE_RESUME_TOOL } from "./anthropic-provider";
export { applyResumeChanges } from "./requests";
export { MockProvider } from "./mock-provider";
export { OpenAIProvider } from "./openai-provider";
export {
  CLAUDE_FALLBACK,
  DEFAULT_ROUTES,
  parseRoute,
  routeFor,
  RoutedProvider,
  type Route,
} from "./routing";
export {
  estimateCostMicroUsd,
  FEATURE_EFFORT,
  DEFAULT_MODEL,
  configuredModel,
  vendorOf,
  type AiFeature,
  type AiVendor,
} from "./config";
export { usageFrom } from "./client";
export { wrapUntrusted } from "./untrusted";
export * from "./schemas";
export type * from "./types";
