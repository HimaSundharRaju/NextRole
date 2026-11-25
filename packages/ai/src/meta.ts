import OpenAI from "openai";
import { ModelUnavailableError } from "./errors";

/*
 * Meta's Model API (the Muse models), which speaks OpenAI's Responses format, so the OpenAI
 * provider serves it with this client.
 */

export const META_BASE_URL = "https://api.meta.ai/v1";

/** Meta trains on what's sent to these cheaper models, so resumes must never go to them. */
export function isTrainingModel(model: string): boolean {
  return /-contributor\b/.test(model);
}

export function createMetaClient(
  env: NodeJS.ProcessEnv = process.env,
  options: { fetch?: typeof fetch } = {},
): OpenAI {
  // Without a key of its own the SDK would take OPENAI_API_KEY and send it to Meta.
  if (!env.META_API_KEY) {
    throw new ModelUnavailableError(
      "The AI service",
      "The AI service is not configured correctly. Please contact support.",
    );
  }
  return new OpenAI({
    apiKey: env.META_API_KEY,
    baseURL: META_BASE_URL,
    // The SDK would otherwise add the OpenAI account's ids from the environment.
    organization: null,
    project: null,
    maxRetries: 2,
    timeout: 5 * 60_000,
    ...options,
  });
}

let client: OpenAI | undefined;

export function getMeta(): OpenAI {
  client ??= createMetaClient();
  return client;
}
