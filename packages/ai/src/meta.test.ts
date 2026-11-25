import { ExternalServiceError } from "@gettargetrole/core/errors";
import { SAMPLE_JOB_DESCRIPTION, SAMPLE_RESUME } from "@gettargetrole/resume/fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enrichmentBatches } from "./batch";
import { estimateCostMicroUsd, vendorOf, type AiFeature } from "./config";
import { ModelUnavailableError } from "./errors";
import { createMetaClient } from "./meta";
import { MockProvider } from "./mock-provider";
import { OpenAIProvider, reasoningEffortFor } from "./openai-provider";
import { configuredVendors, parseRoute } from "./routing";

const FEATURES: AiFeature[] = [
  "import",
  "generate",
  "tailor",
  "match",
  "cover_letter",
  "answers",
  "outreach",
  "interview",
  "studio",
  "enrich",
];

const input = {
  resume: SAMPLE_RESUME,
  job: {
    title: "Senior Backend Engineer",
    company: "Northwind",
    location: "Remote",
    description: SAMPLE_JOB_DESCRIPTION,
  },
  profile: null,
};

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A Meta client whose requests are answered from memory with a fit analysis. */
async function fakeMeta(env: NodeJS.ProcessEnv = { META_API_KEY: "meta-key" }) {
  const fit = await new MockProvider().analyzeFit(input, { userId: null });
  const sent: Sent[] = [];
  const client = createMetaClient(env, {
    fetch: async (url, init) => {
      sent.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({
          id: "resp_1",
          object: "response",
          created_at: 1,
          model: "muse-ember-1.0",
          status: "completed",
          output: [
            {
              type: "message",
              id: "msg_1",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: JSON.stringify(fit), annotations: [] }],
            },
          ],
          incomplete_details: null,
          error: null,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  return { client, sent, fit };
}

afterEach(() => vi.unstubAllEnvs());

describe("Muse through Meta's Model API", () => {
  it("sends to Meta with the Meta key and none of the OpenAI account's identifiers", async () => {
    vi.stubEnv("OPENAI_ORG_ID", "org-openai");
    vi.stubEnv("OPENAI_PROJECT_ID", "proj-openai");
    const { client, sent, fit } = await fakeMeta();
    const ai = new OpenAIProvider(
      () => "muse-ember-1.0",
      () => client,
    );

    await expect(ai.analyzeFit(input, { userId: "user_1" })).resolves.toEqual(fit);

    expect(sent[0]!.url).toBe("https://api.meta.ai/v1/responses");
    expect(sent[0]!.headers.get("authorization")).toBe("Bearer meta-key");
    expect(sent[0]!.headers.get("openai-organization")).toBeNull();
    expect(sent[0]!.headers.get("openai-project")).toBeNull();
    // Resumes aren't kept, and Muse's default effort (the maximum) is never left to apply.
    expect(sent[0]!.body).toMatchObject({ store: false, reasoning: { effort: "low" } });
  });

  it("won't start without a Meta key, so the OpenAI key can't be sent to Meta", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    expect(() => createMetaClient({ OPENAI_API_KEY: "openai-key" })).toThrow(ModelUnavailableError);
  });

  it("always asks for a set effort, and never for none, which Muse rejects", () => {
    for (const model of ["muse-ember-1.0", "muse-spark-1.3"]) {
      for (const feature of FEATURES) {
        const effort = reasoningEffortFor(model, feature);
        expect(effort, `${model} ${feature}`).toMatch(/^(minimal|low|medium)$/);
      }
    }
    expect(reasoningEffortFor("muse-ember-1.0", "enrich")).toBe("minimal");
  });

  it("never sends anything to a model that lets Meta train on prompts", async () => {
    const { client, sent } = await fakeMeta();
    const ai = new OpenAIProvider(
      () => "muse-ember-1.0-contributor",
      () => client,
    );

    await expect(ai.analyzeFit(input, { userId: null })).rejects.toThrow(ExternalServiceError);
    const events = [];
    for await (const event of ai.studioChat(
      { resume: SAMPLE_RESUME, history: [], message: "Shorten my summary" },
      { userId: null },
    )) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["error"]);
    expect(sent).toHaveLength(0);
    expect(parseRoute("meta:muse-ember-1.0-contributor")).toBeNull();
    expect(parseRoute("muse-spark-1.3-contributor")).toBeNull();
  });

  it("routes Muse model names to Meta", () => {
    expect(vendorOf("muse-spark-1.3")).toBe("meta");
    expect(parseRoute("muse-spark-1.3")).toEqual({ vendor: "meta", model: "muse-spark-1.3" });
    expect(parseRoute("meta:muse-ember-1.0")).toEqual({ vendor: "meta", model: "muse-ember-1.0" });
    expect(configuredVendors({ META_API_KEY: "m" })).toEqual({ openai: false, meta: true });
  });

  it("prices Muse, with the higher rate past 200K prompt tokens", () => {
    const tokens = {
      inputTokens: 1000,
      cacheReadTokens: 400,
      outputTokens: 200,
      cacheWriteTokens: 0,
    };
    expect(estimateCostMicroUsd("muse-ember-1.0", tokens)).toBe(202);
    expect(estimateCostMicroUsd("muse-spark-1.3", tokens)).toBe(2160);
    expect(
      estimateCostMicroUsd("muse-ember-1.0", {
        inputTokens: 250_000,
        cacheReadTokens: 0,
        outputTokens: 1000,
        cacheWriteTokens: 0,
      }),
    ).toBe(76_500);
  });

  it("keeps background enrichment on a batch API, which Muse doesn't offer", () => {
    expect(
      enrichmentBatches({
        AI_ROUTE_ENRICH: "meta:muse-ember-1.0",
        OPENAI_API_KEY: "o",
        META_API_KEY: "m",
      }),
    ).toMatchObject({ model: "gpt-4o-mini", batches: { vendor: "openai" } });
  });
});
