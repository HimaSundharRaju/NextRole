import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageBatchResult } from "@anthropic-ai/sdk/resources/beta/messages/batches";
import { createLogger } from "@gettargetrole/core/logger";
import type OpenAI from "openai";
import { toFile } from "openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { AnthropicProvider } from "./anthropic-provider";
import { getAnthropic, mapAnthropicError, type CachePlan } from "./client";
import type { AiFeature, AiVendor } from "./config";
import { getOpenAI, mapOpenAIError, OpenAIProvider } from "./openai-provider";
import { coverLetterRequest, tailorRequest, type FeatureRequest } from "./requests";
import {
  claudeModelFor,
  DEFAULT_ROUTES,
  effectiveRoute,
  parseRoute,
  routeFor,
  type Route,
} from "./routing";
import type { CoverLetter, TailorResult } from "./schemas";
import type { AiCallContext, AiProvider } from "./types";

const log = createLogger("ai-batch");

/*
 * Batch APIs: work that can wait (results within 24 hours, usually minutes) at half the price.
 * `RequestBatches` sends any feature request through one vendor's batch API; `AiBatches` is
 * auto-prepare's view of it, in terms of tailored resumes and cover letters.
 */

export type AnyFeatureRequest = FeatureRequest<unknown, unknown>;

export type RequestResult<Output = unknown> =
  | { status: "succeeded"; output: Output }
  | { status: "failed"; error: string; retryable: boolean };

export interface RequestBatches {
  readonly vendor: AiVendor;
  /** Sends the requests as one batch and returns its id. */
  submit(
    entries: Array<{ id: string; request: AnyFeatureRequest; cache?: CachePlan }>,
  ): Promise<string>;
  /** Whether every entry of the batch has finished (succeeded, failed or expired). */
  isDone(batchId: string): Promise<boolean>;
  /**
   * The results of a finished batch. `requestFor` returns the request and the call context (for
   * metering) of each id still waiting; entries it doesn't know are skipped.
   */
  results(
    batchId: string,
    requestFor: (id: string) => { request: AnyFeatureRequest; ctx: AiCallContext } | undefined,
  ): AsyncGenerator<{ id: string; result: RequestResult }>;
}

const failure = (error: unknown, retryable: boolean): RequestResult => ({
  status: "failed",
  error: error instanceof Error ? error.message : String(error),
  retryable,
});

/** Claude's Message Batches API. */
export class ClaudeRequestBatches implements RequestBatches {
  readonly vendor = "anthropic" as const;

  constructor(
    private readonly provider: AnthropicProvider,
    private readonly api: () => Anthropic = getAnthropic,
  ) {}

  async submit(entries: Array<{ id: string; request: AnyFeatureRequest; cache?: CachePlan }>) {
    const requests = entries.map((entry) => ({
      custom_id: entry.id,
      // Every entry for a feature shares the instructions, and a batch can run for longer than
      // five minutes, so they're cached for an hour.
      params: this.provider.batchParams(
        entry.request,
        entry.cache ?? { system: "1h", stable: null },
      ),
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
    requestFor: (id: string) => { request: AnyFeatureRequest; ctx: AiCallContext } | undefined,
  ): AsyncGenerator<{ id: string; result: RequestResult }> {
    let lines: AsyncIterable<{ custom_id: string; result: BetaMessageBatchResult }>;
    try {
      lines = await this.api().beta.messages.batches.results(batchId);
    } catch (error) {
      throw mapAnthropicError(error);
    }
    for await (const line of lines) {
      const entry = requestFor(line.custom_id);
      if (!entry) continue;
      yield { id: line.custom_id, result: await this.read(entry, line.result) };
    }
  }

  private async read(
    entry: { request: AnyFeatureRequest; ctx: AiCallContext },
    result: BetaMessageBatchResult,
  ): Promise<RequestResult> {
    switch (result.type) {
      case "succeeded":
        try {
          const output = await this.provider.readBatchResult(
            entry.request,
            result.message,
            entry.ctx,
          );
          return { status: "succeeded", output };
        } catch (error) {
          // A refusal, a cut-off answer or output that failed validation: worth one more try.
          return failure(error, true);
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

interface OpenAIBatchLine {
  custom_id: string;
  response: { status_code: number; body: unknown } | null;
  error: { code?: string | null; message?: string | null } | null;
}

const OPENAI_FINISHED = new Set(["completed", "failed", "expired", "cancelled"]);

/** OpenAI's Batch API: the requests go up as a JSONL file and come back as one. */
export class OpenAIRequestBatches implements RequestBatches {
  readonly vendor = "openai" as const;

  constructor(
    private readonly provider: OpenAIProvider,
    private readonly api: () => OpenAI = getOpenAI,
  ) {}

  async submit(entries: Array<{ id: string; request: AnyFeatureRequest }>) {
    const jsonl = entries
      .map((entry) =>
        JSON.stringify({
          custom_id: entry.id,
          method: "POST",
          url: "/v1/responses",
          body: this.provider.batchBody(entry.request),
        }),
      )
      .join("\n");
    try {
      const file = await this.api().files.create({
        file: await toFile(Buffer.from(jsonl), "batch.jsonl"),
        purpose: "batch",
      });
      const batch = await this.api().batches.create({
        input_file_id: file.id,
        endpoint: "/v1/responses",
        completion_window: "24h",
      });
      log.info({ batchId: batch.id, requests: entries.length }, "batch submitted");
      return batch.id;
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }

  async isDone(batchId: string): Promise<boolean> {
    try {
      return OPENAI_FINISHED.has((await this.api().batches.retrieve(batchId)).status);
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }

  async *results(
    batchId: string,
    requestFor: (id: string) => { request: AnyFeatureRequest; ctx: AiCallContext } | undefined,
  ): AsyncGenerator<{ id: string; result: RequestResult }> {
    let files: string[];
    try {
      const batch = await this.api().batches.retrieve(batchId);
      files = [batch.output_file_id, batch.error_file_id].filter((id): id is string => Boolean(id));
    } catch (error) {
      throw mapOpenAIError(error);
    }
    for (const fileId of files) {
      let text: string;
      try {
        text = await (await this.api().files.content(fileId)).text();
      } catch (error) {
        throw mapOpenAIError(error);
      }
      for (const raw of text.split("\n")) {
        if (!raw.trim()) continue;
        const line = JSON.parse(raw) as OpenAIBatchLine;
        const entry = requestFor(line.custom_id);
        if (!entry) continue;
        yield { id: line.custom_id, result: await this.read(entry, line) };
      }
    }
  }

  private async read(
    entry: { request: AnyFeatureRequest; ctx: AiCallContext },
    line: OpenAIBatchLine,
  ): Promise<RequestResult> {
    const status = line.response?.status_code ?? 0;
    if (status === 200) {
      try {
        const output = await this.provider.readBatchResponse(
          entry.request,
          line.response!.body as OpenAIResponse,
          entry.ctx,
        );
        return { status: "succeeded", output };
      } catch (error) {
        return failure(error, true);
      }
    }
    const body = line.response?.body as { error?: { message?: string } } | undefined;
    const message = line.error?.message ?? body?.error?.message ?? `HTTP ${status}`;
    // OpenAI rejects a malformed request (400) every time; limits, outages and expiry pass.
    return {
      status: "failed",
      error: message,
      retryable: status === 0 || status === 429 || status >= 500,
    };
  }
}

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

export type BatchResult = RequestResult<BatchOutput>;

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

function featureRequest(task: BatchTask): AnyFeatureRequest {
  // Each builder's schema and finish belong together; the cast only forgets which feature.
  const request =
    task.feature === "tailor" ? tailorRequest(task.input) : coverLetterRequest(task.input);
  return request as unknown as AnyFeatureRequest;
}

/**
 * Batches on Claude (Message Batches API) for features routed to Claude. The instructions are
 * cached for an hour, since every entry for a feature shares them and a batch can run for longer
 * than five minutes; a resume is cached only when the same user has more than one entry for a
 * feature, because a cache write costs more than it saves when nothing reads it.
 */
export class ClaudeBatches implements AiBatches {
  private readonly requests: ClaudeRequestBatches;

  constructor(
    private readonly routes: (feature: AiFeature) => Route = (feature) => routeFor(feature),
    private readonly options: { openai?: boolean; api?: () => Anthropic } = {},
  ) {
    const provider = new AnthropicProvider((feature) =>
      claudeModelFor(this.routes(feature), feature),
    );
    this.requests = new ClaudeRequestBatches(provider, options.api);
  }

  supports(feature: BatchFeature): boolean {
    return (
      effectiveRoute(this.routes(feature), feature, Boolean(this.options.openai)).vendor ===
      "anthropic"
    );
  }

  submit(entries: BatchEntry[]): Promise<string> {
    const perUser = new Map<string, number>();
    const key = (entry: BatchEntry) => `${entry.userId}:${entry.task.feature}`;
    for (const entry of entries) perUser.set(key(entry), (perUser.get(key(entry)) ?? 0) + 1);
    return this.requests.submit(
      entries.map((entry) => ({
        id: entry.id,
        request: featureRequest(entry.task),
        cache: {
          system: "1h" as const,
          stable: (perUser.get(key(entry)) ?? 0) > 1 ? ("1h" as const) : null,
        },
      })),
    );
  }

  isDone(batchId: string): Promise<boolean> {
    return this.requests.isDone(batchId);
  }

  async *results(
    batchId: string,
    entryFor: (id: string) => { task: BatchTask; ctx: AiCallContext } | undefined,
  ): AsyncGenerator<{ id: string; result: BatchResult }> {
    const requests = this.requests.results(batchId, (id) => {
      const entry = entryFor(id);
      return entry && { request: featureRequest(entry.task), ctx: entry.ctx };
    });
    for await (const { id, result } of requests) {
      yield { id, result: result as BatchResult };
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

/**
 * The batch API job enrichment runs on, and its model: `AI_ROUTE_ENRICH`, or GPT-4o-mini by
 * default. Null when enrichment is off: `ENRICH_JOBS=off`, the mock provider, or the default
 * OpenAI route without an OpenAI key (Claude would cost several times as much for bulk work,
 * so it runs there only when routed explicitly). `AI_MODEL` doesn't apply to this bulk work.
 */
export function enrichmentBatches(
  env: NodeJS.ProcessEnv = process.env,
): { batches: RequestBatches; model: string } | null {
  if (env.AI_PROVIDER === "mock" || env.ENRICH_JOBS === "off") return null;
  const route = (env.AI_ROUTE_ENRICH && parseRoute(env.AI_ROUTE_ENRICH)) || DEFAULT_ROUTES.enrich;
  if (route.vendor === "openai") {
    if (!env.OPENAI_API_KEY) return null;
    return {
      batches: new OpenAIRequestBatches(new OpenAIProvider(() => route.model)),
      model: route.model,
    };
  }
  return {
    batches: new ClaudeRequestBatches(new AnthropicProvider(() => route.model)),
    model: route.model,
  };
}
