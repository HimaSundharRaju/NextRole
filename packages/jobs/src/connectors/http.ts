import { ExternalServiceError } from "@gettargetrole/core/errors";
import type { ConnectorContext } from "./types";

export const USER_AGENT = "GetTargetRoleBot/1.0 (+https://gettargetrole.app/bot)";

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export class BoardNotFoundError extends Error {
  constructor(readonly url: string) {
    super(`Job board not found: ${url}`);
    this.name = "BoardNotFoundError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RequestOptions {
  attempts?: number;
  timeoutMs?: number;
  /** A JSON body, sent with POST. */
  body?: unknown;
  /** Extra headers, such as an API key; they can replace the defaults. */
  headers?: Record<string, string>;
}

/**
 * GET (or, with `body`, POST) a JSON document with a timeout and bounded exponential backoff on
 * transient failures. 404s raise BoardNotFoundError so a misconfigured board is reported rather
 * than retried.
 */
export async function getJson<T>(
  url: string,
  context: ConnectorContext,
  { attempts = 3, timeoutMs = 20_000, body, headers: extra = {} }: RequestOptions = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
    try {
      const response = await context.fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          accept: "application/json",
          "user-agent": USER_AGENT,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      if (response.status === 404) throw new BoardNotFoundError(url);
      if (response.ok) return (await response.json()) as T;
      lastError = new ExternalServiceError(
        new URL(url).host,
        `HTTP ${response.status} from ${url}`,
      );
      if (!RETRYABLE.has(response.status)) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      if (attempt < attempts) {
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt,
        );
      }
    } catch (error) {
      if (error instanceof BoardNotFoundError || context.signal?.aborted) throw error;
      lastError = error;
      if (attempt < attempts) await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}
