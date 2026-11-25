import Anthropic from "@anthropic-ai/sdk";
import { SAMPLE_JOB_DESCRIPTION, SAMPLE_RESUME } from "@gettargetrole/resume/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { ClaudeBatches, type BatchEntry, type BatchTask } from "./batch";
import { RESULT_TOOL_NAME } from "./client";
import { DEFAULT_ROUTES, type Route } from "./routing";
import type { TailorOutput, TailorResult } from "./schemas";
import type { UsageRecord } from "./types";

const BASE = "http://batches.test";

const job = {
  title: "Senior Backend Engineer",
  company: "Northwind",
  location: "Remote",
  description: SAMPLE_JOB_DESCRIPTION,
};

const tailorTask: BatchTask = { feature: "tailor", input: { resume: SAMPLE_RESUME, job } };
const letterTask: BatchTask = {
  feature: "cover_letter",
  input: { resume: SAMPLE_RESUME, job, profile: null },
};

/** The parts of a sent batch entry the tests look at. */
interface SentParams {
  model: string;
  system: Array<{ cache_control?: unknown }>;
  messages: Array<{ content: Array<{ cache_control?: unknown }> }>;
  tools?: Array<{ name: string }>;
  output_config?: { format?: { type: string } };
}

interface Recorded {
  method: string;
  url: string;
  headers: Headers;
  body: Record<string, unknown> | null;
}

/** The Message Batches endpoints, answered from memory through the client's fetch. */
function fakeBatchApi() {
  const requests: Recorded[] = [];
  const state = { status: "in_progress" as "in_progress" | "ended", lines: [] as unknown[] };
  const batch = (id: string) => ({
    id,
    type: "message_batch",
    processing_status: state.status,
    request_counts: { processing: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    ended_at: null,
    created_at: "2026-09-26T00:00:00Z",
    expires_at: "2026-09-27T00:00:00Z",
    archived_at: null,
    cancel_initiated_at: null,
    results_url: state.status === "ended" ? `${BASE}/v1/messages/batches/${id}/results` : null,
  });
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({
      method: init?.method ?? "GET",
      url: url.pathname,
      headers: new Headers(init?.headers),
      body,
    });
    if (url.pathname === "/v1/messages/batches" && init?.method === "POST")
      return json(batch("msgbatch_1"));
    const results = url.pathname.match(/^\/v1\/messages\/batches\/([^/]+)\/results$/);
    if (results) {
      return new Response(state.lines.map((line) => JSON.stringify(line)).join("\n"), {
        headers: { "content-type": "application/binary" },
      });
    }
    const one = url.pathname.match(/^\/v1\/messages\/batches\/([^/]+)$/);
    if (one) return json(batch(one[1]!));
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  const client = new Anthropic({ apiKey: "test-key", baseURL: BASE, fetch, maxRetries: 0 });
  return { client, requests, state };
}

function message(content: unknown[], stopReason: string, usage: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 2000,
      cache_creation: { ephemeral_1h_input_tokens: 2000, ephemeral_5m_input_tokens: 0 },
      ...usage,
    },
  };
}

const tailored: TailorOutput = {
  headline: "Staff Backend Engineer, Payments",
  summary: "Tailored summary.",
  summaryOfChanges: ["Rewrote the summary"],
  addedKeywords: ["grpc"],
  missingKeywords: [],
  suggestions: [],
};

describe("ClaudeBatches", () => {
  let api: ReturnType<typeof fakeBatchApi>;
  let batches: ClaudeBatches;

  beforeEach(() => {
    api = fakeBatchApi();
    batches = new ClaudeBatches((feature) => DEFAULT_ROUTES[feature], { api: () => api.client });
  });

  it("sends each task with its live prompt, caching what other entries will reuse", async () => {
    const entries: BatchEntry[] = [
      { id: "a-tailor", userId: "u1", task: tailorTask },
      { id: "b-tailor", userId: "u1", task: tailorTask },
      { id: "c-tailor", userId: "u2", task: tailorTask },
      { id: "c-letter", userId: "u2", task: letterTask },
    ];
    expect(await batches.submit(entries)).toBe("msgbatch_1");

    const [create] = api.requests;
    expect(create!.url).toBe("/v1/messages/batches");
    // Refusal fallbacks need a beta header for the whole batch, so batches go without them.
    expect(create!.headers.get("anthropic-beta")).toBe("message-batches-2024-09-24");
    const sent = create!.body!.requests as Array<{ custom_id: string; params: SentParams }>;
    expect(sent.map((entry) => entry.custom_id)).toEqual(entries.map((entry) => entry.id));
    for (const { params } of sent) {
      expect(params.model).toBe("claude-sonnet-5");
      expect(params).not.toHaveProperty("fallbacks");
      expect(params).not.toHaveProperty("betas");
      // Every entry for a feature shares the instructions: cached for an hour.
      expect(params.system[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    }
    const resumeCache = (index: number) =>
      sent[index]!.params.messages[0]!.content[0]!.cache_control;
    // u1 has two tailoring entries that share a resume; u2's resume is read once per feature.
    expect(resumeCache(0)).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(resumeCache(1)).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(resumeCache(2)).toBeUndefined();
    expect(sent[2]!.params.tools?.[0]?.name).toBe(RESULT_TOOL_NAME);
    expect(sent[3]!.params.output_config?.format?.type).toBe("json_schema");
  });

  it("reports whether a batch has ended", async () => {
    expect(await batches.isDone("msgbatch_1")).toBe(false);
    api.state.status = "ended";
    expect(await batches.isDone("msgbatch_1")).toBe(true);
  });

  it("reads each result, metering at the batch price and marking what to retry", async () => {
    api.state.status = "ended";
    api.state.lines = [
      {
        custom_id: "ok",
        result: {
          type: "succeeded",
          message: message(
            [{ type: "tool_use", id: "toolu_1", name: RESULT_TOOL_NAME, input: tailored }],
            "tool_use",
          ),
        },
      },
      { custom_id: "refused", result: { type: "succeeded", message: message([], "refusal") } },
      {
        custom_id: "bad",
        result: {
          type: "errored",
          error: {
            type: "error",
            request_id: null,
            error: { type: "invalid_request_error", message: "max_tokens: too large" },
          },
        },
      },
      {
        custom_id: "busy",
        result: {
          type: "errored",
          error: {
            type: "error",
            request_id: null,
            error: { type: "overloaded_error", message: "Overloaded" },
          },
        },
      },
      { custom_id: "late", result: { type: "expired" } },
      { custom_id: "not-ours", result: { type: "expired" } },
    ];
    const usage: UsageRecord[] = [];
    const ctx = { userId: "u1", onUsage: (record: UsageRecord) => void usage.push(record) };
    const known = new Set(["ok", "refused", "bad", "busy", "late"]);
    const results = new Map();
    for await (const { id, result } of batches.results("msgbatch_1", (id) =>
      known.has(id) ? { task: tailorTask, ctx } : undefined,
    )) {
      results.set(id, result);
    }

    expect([...results.keys()]).toEqual(["ok", "refused", "bad", "busy", "late"]);
    const ok = results.get("ok");
    expect(ok.status).toBe("succeeded");
    // The same finishing step as a live call: untouched sections come from the original.
    const output = ok.output as TailorResult;
    expect(output.resume.basics.headline).toBe("Staff Backend Engineer, Payments");
    expect(output.resume.experience).toEqual(SAMPLE_RESUME.experience);
    expect(results.get("refused")).toMatchObject({ status: "failed", retryable: true });
    expect(results.get("bad")).toMatchObject({ status: "failed", retryable: false });
    expect(results.get("busy")).toMatchObject({ status: "failed", retryable: true });
    expect(results.get("late")).toMatchObject({ status: "failed", retryable: true });

    // Both succeeded messages are metered (the refusal was paid for too), at half price: Sonnet 5
    // input $2, 1-hour cache writes $4, output $10 per million tokens, halved.
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ feature: "tailor", batch: true, cacheWriteTokens: 2000 });
    expect(usage[0]!.costMicroUsd).toBe((1000 * 2 + 2000 * 4 + 500 * 10) / 2);
  });

  it("batches only features that run on Claude", () => {
    const routes = (tailor: Route) => (feature: keyof typeof DEFAULT_ROUTES) =>
      feature === "tailor" ? tailor : DEFAULT_ROUTES[feature];
    const onOpenAi = routes({ vendor: "openai", model: "gpt-5-mini" });
    expect(new ClaudeBatches(onOpenAi, { openai: true }).supports("tailor")).toBe(false);
    // Without OpenAI configured the route falls back to Claude, which batches.
    expect(new ClaudeBatches(onOpenAi, { openai: false }).supports("tailor")).toBe(true);
    expect(batches.supports("cover_letter")).toBe(true);
  });
});
