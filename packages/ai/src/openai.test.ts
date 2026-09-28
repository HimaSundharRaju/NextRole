import { AiRefusalError, ExternalServiceError } from "@gettargetrole/core/errors";
import type { Resume } from "@gettargetrole/resume/schema";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { estimateCostMicroUsd, type AiFeature } from "./config";
import { MockProvider } from "./mock-provider";
import { OpenAIProvider } from "./openai-provider";
import { TAILOR_SYSTEM } from "./prompts";
import {
  CLAUDE_FALLBACK,
  DEFAULT_ROUTES,
  parseRoute,
  routeFor,
  RoutedProvider,
  type Route,
} from "./routing";
import type { AiProvider, JobContext, StudioEvent, UsageRecord } from "./types";

const RESUME: Resume = {
  basics: {
    name: "Priya Shah",
    headline: "Backend Engineer",
    email: "priya@example.com",
    phone: "+1 555 0100",
    location: "Austin, TX",
    links: [],
  },
  summary: "Backend engineer who builds payment systems in Go.",
  experience: [
    {
      company: "Ledgerly",
      title: "Software Engineer",
      location: "Austin, TX",
      startDate: "Jan 2021",
      endDate: "Present",
      highlights: ["Cut settlement time by 40% by moving batch jobs to Go services"],
    },
  ],
  education: [],
  skills: [{ name: "Languages", items: ["Go", "PostgreSQL"] }],
  projects: [],
  certifications: [],
  customSections: [],
};

const JOB: JobContext = {
  title: "Senior Software Engineer, Payments",
  company: "Acme",
  location: "Remote",
  description: "Build payment services in Go on Kubernetes.",
};

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

function responseJson(model: string, output: unknown[], extra: Record<string, unknown> = {}) {
  return {
    id: "resp_1",
    object: "response",
    created_at: 1,
    model,
    status: "completed",
    output,
    parallel_tool_calls: true,
    tool_choice: "auto",
    tools: [],
    incomplete_details: null,
    error: null,
    usage: {
      input_tokens: 1000,
      input_tokens_details: { cached_tokens: 400 },
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 50 },
      total_tokens: 1200,
    },
    ...extra,
  };
}

const message = (text: string) => ({
  type: "message",
  id: "msg_1",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});

/** An OpenAI client whose requests go to `respond` instead of the network. */
function fakeClient(respond: (body: Record<string, unknown>) => Response, captured: Captured[]) {
  return new OpenAI({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      captured.push({ url: String(input), body });
      return respond(body);
    },
  });
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

function sse(events: Array<Record<string, unknown>>) {
  const payload = events
    .map((event, index) => {
      const data = { ...event, sequence_number: index };
      return `event: ${String(event.type)}\ndata: ${JSON.stringify(data)}\n\n`;
    })
    .join("");
  return new Response(payload, { headers: { "content-type": "text/event-stream" } });
}

function provider(respond: (body: Record<string, unknown>) => Response, model = "gpt-4o-mini") {
  const captured: Captured[] = [];
  const client = fakeClient(respond, captured);
  return {
    ai: new OpenAIProvider(
      () => model,
      () => client,
    ),
    captured,
  };
}

describe("OpenAIProvider", () => {
  it("tailors with the shared prompt, strict JSON output and no stored response", async () => {
    const usage: UsageRecord[] = [];
    const { ai, captured } = provider(() =>
      json(
        responseJson("gpt-4o-mini", [
          message(
            JSON.stringify({
              headline: "Senior Payments Engineer",
              summary: null,
              experience: null,
              education: null,
              skills: null,
              projects: null,
              certifications: null,
              customSections: null,
              summaryOfChanges: ["Retitled the headline for payments."],
              addedKeywords: [],
              missingKeywords: ["Kubernetes"],
              suggestions: [],
            }),
          ),
        ]),
      ),
    );
    const result = await ai.tailorResume(
      { resume: RESUME, job: JOB },
      { userId: "user-1", onUsage: (record) => void usage.push(record) },
    );

    expect(result.resume.basics).toEqual({
      ...RESUME.basics,
      headline: "Senior Payments Engineer",
    });
    expect(result.resume.experience).toEqual(RESUME.experience);
    expect(result.missingKeywords).toEqual(["Kubernetes"]);

    const body = captured[0]!.body;
    expect(captured[0]!.url).toMatch(/\/responses$/);
    expect(body).toMatchObject({ model: "gpt-4o-mini", instructions: TAILOR_SYSTEM, store: false });
    expect(body).not.toHaveProperty("reasoning");
    // The resume goes first so a user's next request shares the cached prefix.
    const content = (body.input as Array<{ content: Array<{ text: string }> }>)[0]!.content;
    expect(content[0]!.text).toContain('"Priya Shah"');
    expect(content[1]!.text).toContain("Senior Software Engineer, Payments");
    expect(body.text).toMatchObject({ format: { type: "json_schema", strict: true } });
    // OpenAI sees a hash, never the account id.
    expect(body.prompt_cache_key).toMatch(/^[0-9a-f]{32}$/);
    expect(body.prompt_cache_key).not.toBe("user-1");

    expect(usage).toEqual([
      {
        feature: "tailor",
        model: "gpt-4o-mini",
        inputTokens: 600,
        cacheReadTokens: 400,
        cacheWriteTokens: 0,
        outputTokens: 200,
        costMicroUsd: estimateCostMicroUsd("gpt-4o-mini", {
          inputTokens: 600,
          cacheReadTokens: 400,
          cacheWriteTokens: 0,
          outputTokens: 200,
        }),
      },
    ]);
  });

  it("sets reasoning effort per feature on reasoning models only", async () => {
    const { ai, captured } = provider(
      () =>
        json(
          responseJson("gpt-5-mini", [
            message(
              JSON.stringify({
                score: 83.6,
                verdict: "strong",
                summary: "Good fit.",
                strengths: ["Go"],
                gaps: [],
                recommendation: "Apply now.",
              }),
            ),
          ]),
        ),
      "gpt-5-mini",
    );
    const fit = await ai.analyzeFit({ resume: RESUME, job: JOB }, { userId: null });
    expect(fit.score).toBe(84);
    expect(captured[0]!.body.reasoning).toEqual({ effort: "low" });
    expect(captured[0]!.body).not.toHaveProperty("prompt_cache_key");
  });

  it("raises AiRefusalError when the model refuses", async () => {
    const { ai } = provider(() =>
      json(
        responseJson("gpt-4o-mini", [
          {
            type: "message",
            id: "msg_1",
            role: "assistant",
            status: "completed",
            content: [{ type: "refusal", refusal: "I can't help with that." }],
          },
        ]),
      ),
    );
    await expect(
      ai.writeCoverLetter({ resume: RESUME, job: JOB }, { userId: null }),
    ).rejects.toBeInstanceOf(AiRefusalError);
  });

  it("reports an output cut off at the token limit", async () => {
    const { ai } = provider(() =>
      json(
        responseJson("gpt-4o-mini", [message('{"subject":"Hi","body":"Dear')], {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        }),
      ),
    );
    await expect(
      ai.writeCoverLetter({ resume: RESUME, job: JOB }, { userId: null }),
    ).rejects.toThrow(/cut off|incomplete/);
  });

  it("maps API errors to user-safe messages", async () => {
    const { ai } = provider(() => json({ error: { message: "slow down" } }, 429));
    await expect(
      ai.answerQuestions({ resume: RESUME, job: JOB, questions: ["Why us?"] }, { userId: null }),
    ).rejects.toThrow("The AI service is busy right now");
  });

  it("streams Studio replies and applies the resume edit from the function call", async () => {
    const edit = {
      change_summary: "Tightened the summary",
      basics: null,
      summary: "Payments engineer who ships reliable Go services.",
      experience: null,
      education: null,
      skills: null,
      projects: null,
      certifications: null,
      customSections: null,
    };
    const reply = "Tightened your summary.";
    const call = {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "update_resume",
      arguments: JSON.stringify(edit),
      status: "completed",
    };
    const done = responseJson("gpt-4o-mini", [message(reply), call]);
    const { ai, captured } = provider(() =>
      sse([
        { type: "response.created", response: { ...done, status: "in_progress", output: [] } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...message(""), status: "in_progress", content: [] },
        },
        {
          type: "response.content_part.added",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        },
        {
          type: "response.output_text.delta",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: reply,
          logprobs: [],
        },
        {
          type: "response.output_text.done",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          text: reply,
          logprobs: [],
        },
        {
          type: "response.content_part.done",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: reply, annotations: [] },
        },
        { type: "response.output_item.done", output_index: 0, item: message(reply) },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: { ...call, arguments: "", status: "in_progress" },
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          output_index: 1,
          delta: call.arguments,
        },
        {
          type: "response.function_call_arguments.done",
          item_id: "fc_1",
          output_index: 1,
          arguments: call.arguments,
        },
        { type: "response.output_item.done", output_index: 1, item: call },
        { type: "response.completed", response: done },
      ]),
    );

    const events: StudioEvent[] = [];
    for await (const event of ai.studioChat(
      { resume: RESUME, history: [], message: "Make my summary punchier" },
      { userId: "user-1" },
    )) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["text", "resume", "done"]);
    const applied = events[1] as Extract<StudioEvent, { type: "resume" }>;
    expect(applied.resume.summary).toBe(edit.summary);
    expect(applied.resume.experience).toEqual(RESUME.experience);
    expect(events[2]).toEqual({ type: "done", reply, changed: true });
    expect(captured[0]!.body).toMatchObject({ stream: true, tool_choice: "auto", store: false });
    expect((captured[0]!.body.tools as Array<{ name: string }>)[0]!.name).toBe("update_resume");
  });
});

describe("routing", () => {
  it("parses route overrides", () => {
    expect(parseRoute("openai:gpt-5-mini")).toEqual({ vendor: "openai", model: "gpt-5-mini" });
    expect(parseRoute("anthropic:claude-sonnet-5")).toEqual({
      vendor: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(parseRoute("claude-haiku-4-5")).toEqual({
      vendor: "anthropic",
      model: "claude-haiku-4-5",
    });
    expect(parseRoute("gpt-4o-mini")).toEqual({ vendor: "openai", model: "gpt-4o-mini" });
    expect(parseRoute("azure:gpt-4o")).toBeNull();
  });

  it("prefers a feature override, then AI_MODEL, then the defaults", () => {
    const env = { AI_ROUTE_TAILOR: "openai:gpt-5-mini", AI_MODEL: "claude-haiku-4-5" };
    expect(routeFor("tailor", env)).toEqual({ vendor: "openai", model: "gpt-5-mini" });
    expect(routeFor("match", env)).toEqual({ vendor: "anthropic", model: "claude-haiku-4-5" });
    expect(routeFor("match", {}).vendor).toBeDefined();
  });

  class FailingProvider extends MockProvider {
    override async writeCoverLetter(): ReturnType<AiProvider["writeCoverLetter"]> {
      throw new ExternalServiceError("The AI service");
    }
  }

  const routes =
    (map: Partial<Record<AiFeature, Route>>) =>
    (feature: AiFeature): Route =>
      map[feature] ?? { vendor: "anthropic", model: "claude-haiku-4-5" };

  it("retries on Claude when the OpenAI route fails", async () => {
    const claude = new MockProvider();
    const routed = new RoutedProvider(
      routes({ cover_letter: { vendor: "openai", model: "gpt-4o-mini" } }),
      {
        anthropic: claude as never,
        openaiProvider: new FailingProvider() as never,
      },
    );
    const letter = await routed.writeCoverLetter({ resume: RESUME, job: JOB }, { userId: null });
    expect(letter.body).toContain("Acme");
  });

  it("gives every OpenAI default route a Claude fallback", () => {
    for (const [feature, route] of Object.entries(DEFAULT_ROUTES)) {
      expect(CLAUDE_FALLBACK[feature as AiFeature], feature).toMatch(/^claude-/);
      if (route.vendor === "openai") expect(route.model, feature).toMatch(/^gpt-/);
    }
    const unrouted = new RoutedProvider((feature) => routeFor(feature, {}));
    expect(unrouted.modelFor("match")).toBe("claude-haiku-4-5");
  });

  it("keeps OpenAI routes on Claude when OpenAI isn't configured", () => {
    const routed = new RoutedProvider(
      routes({ tailor: { vendor: "openai", model: "gpt-5-mini" } }),
    );
    expect(routed.modelFor("tailor")).toMatch(/^claude-/);
    expect(routed.modelFor("match")).toBe("claude-haiku-4-5");
  });
});

describe("OpenAI cost estimation", () => {
  it("prices cached input separately and strips snapshot dates", () => {
    const tokens = {
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    };
    // gpt-4o-mini: $0.15 input, $0.075 cached, $0.60 output per million tokens.
    expect(estimateCostMicroUsd("gpt-4o-mini", tokens)).toBe(825_000);
    expect(estimateCostMicroUsd("gpt-4o-mini-2024-07-18", tokens)).toBe(825_000);
    // gpt-5-mini: $0.25, $0.025, $2.
    expect(estimateCostMicroUsd("gpt-5-mini", tokens)).toBe(2_275_000);
  });
});
