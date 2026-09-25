import { AnthropicProvider } from "./anthropic-provider";
import { MockProvider } from "./mock-provider";
import type { AiProvider } from "./types";

let provider: AiProvider | undefined;

/** The configured AI provider: Claude in every real environment, a deterministic mock in tests. */
export function getAi(): AiProvider {
  if (!provider) {
    const useMock = process.env.AI_PROVIDER === "mock";
    if (useMock && process.env.NODE_ENV === "production") {
      throw new Error("AI_PROVIDER=mock is not allowed in production");
    }
    provider = useMock ? new MockProvider() : new AnthropicProvider();
  }
  return provider;
}

/** Test helper. */
export function setAiProvider(next: AiProvider | undefined): void {
  provider = next;
}

export {
  applyResumeChanges,
  AnthropicProvider,
  resumeSourceToContent,
  UPDATE_RESUME_TOOL,
} from "./anthropic-provider";
export { MockProvider } from "./mock-provider";
export {
  estimateCostMicroUsd,
  FEATURE_EFFORT,
  DEFAULT_MODEL,
  configuredModel,
  type AiFeature,
} from "./config";
export { usageFrom } from "./client";
export { wrapUntrusted } from "./untrusted";
export * from "./schemas";
export type * from "./types";
