import { MockProvider } from "./mock-provider";
import { configuredVendors, RoutedProvider } from "./routing";
import type { AiProvider } from "./types";

let provider: AiProvider | undefined;

/**
 * The configured AI provider: auto mode, which runs each feature on its first tested model whose
 * vendor has a key (Claude, plus OpenAI and Meta when theirs are set), or a deterministic mock
 * in tests.
 */
export function getAi(): AiProvider {
  if (!provider) {
    const useMock = process.env.AI_PROVIDER === "mock";
    if (useMock && process.env.NODE_ENV === "production") {
      throw new Error("AI_PROVIDER=mock is not allowed in production");
    }
    provider = useMock
      ? new MockProvider()
      : new RoutedProvider(undefined, { vendors: configuredVendors() });
  }
  return provider;
}

/** Test helper. */
export function setAiProvider(next: AiProvider | undefined): void {
  provider = next;
}

export { AnthropicProvider, UPDATE_RESUME_TOOL } from "./anthropic-provider";
export {
  ClaudeBatches,
  ClaudeRequestBatches,
  enrichmentBatches,
  getAiBatches,
  OpenAIRequestBatches,
  type AiBatches,
  type AnyFeatureRequest,
  type BatchEntry,
  type BatchFeature,
  type BatchOutput,
  type BatchResult,
  type BatchTask,
  type RequestBatches,
  type RequestResult,
} from "./batch";
export {
  CONTRACT_TERMS,
  EDUCATION_LEVELS,
  enrichRequest,
  foldText,
  SENIORITIES,
  verifyEnrichment,
  type EnrichmentOutput,
  type JobEnrichment,
} from "./enrich";
export { applyResumeChanges } from "./requests";
export { MockProvider } from "./mock-provider";
export { OpenAIProvider } from "./openai-provider";
export {
  claudeModelFor,
  CLAUDE_FALLBACK,
  configuredVendors,
  DEFAULT_ROUTES,
  parseRoute,
  routeChain,
  routeFor,
  RoutedProvider,
  usableRoutes,
  type Route,
  type VerifiedRoutes,
  type Vendors,
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
