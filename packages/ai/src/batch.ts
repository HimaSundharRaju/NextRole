import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageBatchResult } from "@anthropic-ai/sdk/resources/beta/messages/batches";
import { createLogger } from "@gettargetrole/core/logger";
import { AnthropicProvider } from "./anthropic-provider";
import { getAnthropic, mapAnthropicError } from "./client";
import type { AiFeature } from "./config";
import { coverLetterRequest, tailorRequest, type FeatureRequest } from "./requests";
import { claudeModelFor, effectiveRoute, routeFor, type Route } from "./routing";
import type { CoverLetter, TailorResult } from "./schemas";
import type { AiCallContext, AiProvider } from "./types";

const log = createLogger("ai-batch");

/**
 * Work that can wait for a batch API, which charges half price and returns results within 24
 * hours (usually minutes): auto-prepare's tailored resumes and cover letters.
 */
export type BatchTask =
  | { feature: "tailor"; input: Parameters<AiProvider["tailorResume"]>[0] }
  | { feature: "cover_letter"; input: Parameters<AiProvider["writeCoverLetter"]>[0] };

export type BatchFeature = BatchTask["feature"];

export type BatchOutput = TailorResult | CoverLetter;

export interface BatchEntry {
  /** Unique within the batch; results come back under it. */
  id: string;
  userId: string;
  task: BatchTask;
}

export type BatchResult =
  | { status: "succeeded"; output: BatchOutput }
  | { status: "failed"; error: string; retryable: boolean };

export interface AiBatches {
  /** Whether a task for `feature` can go into a batch. */
  supports(feature: BatchFeature): boolean;
  /** Sends the entries as one batch and returns its id. */
  submit(entries: BatchEntry[]): Promise<string>;
  /** Whether every entry of the batch has finished (succeeded, failed or expired). */
  isDone(batchId: string): Promise<boolean>;
  /**
   * The results of a finished batch. `entryFor` returns the task and the call context (for
   * metering) of each id still waiting; entries it doesn't know are skipped.
   */
  results(
    batchId: string,
    entryFor: (id: string) => { task: BatchTask; ctx: AiCallContext } | undefined,
  ): AsyncGenerator<{ id: string; result: BatchResult }>;
}

type AnyRequest = FeatureRequest<unknown, BatchOutput>;

function featureRequest(task: BatchTask): AnyRequest {
  // Each builder's schema and finish belong together; the cast only forgets which feature.
  const request =
    task.feature === "tailor" ? tailorRequest(task.input) : coverLetterRequest(task.input);
  return request as unknown as AnyRequest;
}

/**
 * Batches on Claude (Message Batches API) for features routed to Claude. The instructions are
 * cached for an hour, since every entry for a feature shares them and a batch can run for longer
 * than five minutes; a resume is cached only when the same user has more than one entry for a
 * feature, because a cache write costs more than it saves when nothing reads it.
 */
export class ClaudeBatches implements AiBatches {
  private readonly provider: AnthropicProvider;

  constructor(
    private readonly routes: (feature: AiFeature) => Route = (feature) => routeFor(feature),
    private readonly options: { openai?: boolean; api?: () => Anthropic } = {},
  ) {
    this.provider = new AnthropicProvider((feature) =>
      claudeModelFor(this.routes(feature), feature),
    );
  }

  private api(): Anthropic {
    return (this.options.api ?? getAnthropic)();
  }

  supports(feature: BatchFeature): boolean {
    return (
      effectiveRoute(this.routes(feature), feature, Boolean(this.options.openai)).vendor ===
      "anthropic"
    );
  }

  async submit(entries: BatchEntry[]): Promise<string> {
    const perUser = new Map<string, number>();
    const key = (entry: BatchEntry) => `${entry.userId}:${entry.task.feature}`;
    for (const entry of entries) perUser.set(key(entry), (perUser.get(key(entry)) ?? 0) + 1);
    const requests = entries.map((entry) => ({
      custom_id: entry.id,
      params: this.provider.batchParams(featureRequest(entry.task), {
        system: "1h" as const,
        stable: (perUser.get(key(entry)) ?? 0) > 1 ? ("1h" as const) : null,
      }),
    }));
    try {
      const batch = await this.api().beta.messages.batches.create({ requests });
      log.info({ batchId: batch.id, requests: requests.length }, "batch submitted");
      return batch.id;
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }

  async isDone(batchId: string): Promise<boolean> {
    try {
      const batch = await this.api().beta.messages.batches.retrieve(batchId);
      return batch.processing_status === "ended";
    } catch (error) {
      throw mapAnthropicError(error);
    }
  }

  async *results(
    batchId: string,
    entryFor: (id: string) => { task: BatchTask; ctx: AiCallContext } | undefined,
  ): AsyncGenerator<{ id: string; result: BatchResult }> {
    let lines: AsyncIterable<{ custom_id: string; result: BetaMessageBatchResult }>;
    try {
      lines = await this.api().beta.messages.batches.results(batchId);
    } catch (error) {
      throw mapAnthropicError(error);
    }
    for await (const line of lines) {
      const entry = entryFor(line.custom_id);
      if (!entry) continue;
      yield { id: line.custom_id, result: await this.read(entry, line.result) };
    }
  }

  private async read(
    entry: { task: BatchTask; ctx: AiCallContext },
    result: BetaMessageBatchResult,
  ): Promise<BatchResult> {
    switch (result.type) {
      case "succeeded":
        try {
          const request = featureRequest(entry.task);
          const output = await this.provider.readBatchResult(request, result.message, entry.ctx);
          return { status: "succeeded", output };
        } catch (error) {
          // A refusal, a cut-off answer or output that failed validation: worth one more try.
          return {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            retryable: true,
          };
        }
      case "errored":
        // The API rejects a malformed request every time; other errors are transient.
        return {
          status: "failed",
          error: result.error.error.message,
          retryable: result.error.error.type !== "invalid_request_error",
        };
      case "expired":
        return { status: "failed", error: "The batch expired before this ran.", retryable: true };
      case "canceled":
        return { status: "failed", error: "The batch was canceled.", retryable: true };
    }
  }
}

let batches: AiBatches | null | undefined;

/** Batch processing for background AI work; null with the mock provider. */
export function getAiBatches(): AiBatches | null {
  if (batches === undefined) {
    batches =
      process.env.AI_PROVIDER === "mock"
        ? null
        : new ClaudeBatches(undefined, { openai: Boolean(process.env.OPENAI_API_KEY) });
  }
  return batches;
}
