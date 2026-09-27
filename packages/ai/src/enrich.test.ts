import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { enrichmentBatches, OpenAIRequestBatches, type AnyFeatureRequest } from "./batch";
import {
  enrichRequest,
  foldText,
  numbersIn,
  verifyEnrichment,
  type EnrichmentOutput,
  type JobEnrichment,
} from "./enrich";
import { OpenAIProvider } from "./openai-provider";
import type { UsageRecord } from "./types";

const POSTING = `Senior Backend Engineer
We're building payments infrastructure in Go.
Requirements: 5+ years of backend experience; Bachelor’s degree in Computer Science or equivalent.
This is a W2 contract role — no C2C.
The base pay range for this role is 150,000 – 190,000 USD per year.
We are unable to sponsor visas now or in the future.
Remote within the United States.`;

function output(overrides: Partial<EnrichmentOutput> = {}): EnrichmentOutput {
  return {
    summary: "Builds payment services in Go.",
    seniority: "senior",
    seniorityQuote: "Senior Backend Engineer",
    yearsMin: 5,
    yearsQuote: "5+ years of backend experience",
    education: "bachelors",
    educationQuote: "Bachelor's degree in Computer Science",
    salaryMin: 150000,
    salaryMax: 190000,
    salaryCurrency: "usd",
    salaryPeriod: "year",
    salaryQuote: "150,000 - 190,000 USD per year",
    contractTerms: ["w2"],
    contractQuote: "This is a W2 contract role",
    workplace: "remote",
    workplaceQuote: "Remote within the United States",
    sponsorship: "no",
    sponsorshipQuote: "unable to sponsor visas now or in the future",
    citizenshipRequired: null,
    citizenshipQuote: null,
    evergreen: false,
    evergreenQuote: null,
    ...overrides,
  };
}

describe("verifyEnrichment", () => {
  it("keeps facts the posting states, matching quotes across typography", () => {
    const enrichment = verifyEnrichment(output(), POSTING);
    expect(enrichment).toMatchObject({
      seniority: "senior",
      yearsMin: 5,
      education: "bachelors",
      salary: { min: 150000, max: 190000, currency: "USD", period: "year" },
      contractTerms: ["w2"],
      workplace: "remote",
      sponsorship: "no",
      citizenshipRequired: null,
      evergreen: false,
      dropped: [],
    });
    // The quote used a plain apostrophe and hyphen; the posting has typographic ones.
    expect(enrichment.quotes.education).toBe("Bachelor's degree in Computer Science");
  });

  it("drops facts whose quotes aren't in the posting, or whose numbers aren't in the quote", () => {
    const enrichment = verifyEnrichment(
      output({
        yearsMin: 7,
        sponsorshipQuote: "We sponsor H-1B visas",
        salaryMin: 160000,
        workplaceQuote: "Remote",
        citizenshipRequired: true,
        citizenshipQuote: "Active clearance required",
        evergreen: true,
        evergreenQuote: null,
      }),
      POSTING,
    );
    expect(enrichment).toMatchObject({
      yearsMin: null,
      salary: null,
      sponsorship: null,
      citizenshipRequired: null,
      evergreen: false,
      // A short quote that appears in the posting still counts.
      workplace: "remote",
    });
    expect(enrichment.dropped.sort()).toEqual(
      ["citizenship", "evergreen", "salary", "sponsorship", "years"].sort(),
    );
  });

  it("keeps a level only when the title or posting states it", () => {
    const guessed = verifyEnrichment(output({ seniority: "staff", seniorityQuote: null }), POSTING);
    expect(guessed.seniority).toBeNull();
    expect(guessed.dropped).toContain("seniority");
    expect(verifyEnrichment(output(), POSTING).quotes.seniority).toBe("Senior Backend Engineer");
  });

  it("rejects impossible salaries and bad currencies", () => {
    const backwards = verifyEnrichment(
      output({ salaryMin: 190000, salaryMax: 150000, salaryQuote: "150,000 – 190,000 USD" }),
      POSTING,
    );
    expect(backwards.salary).toBeNull();
    const oneFigure = verifyEnrichment(
      output({
        salaryMin: 150000,
        salaryMax: null,
        salaryCurrency: "dollars",
        salaryQuote: "150,000",
      }),
      POSTING,
    );
    expect(oneFigure.salary).toEqual({ min: 150000, max: 150000, currency: "USD", period: "year" });
  });

  it("reads numbers the way postings write them", () => {
    expect(numbersIn("$150k - $190k")).toEqual([150000, 190000]);
    expect(numbersIn("3-5 years")).toEqual([3, 5]);
    expect(numbersIn("120,000.50 per year")).toEqual([120000.5]);
    expect(foldText("  “Remote”\n—  U.S. ")).toBe('"remote" - u.s.');
    // Entities left in a description don't stop a quote from matching.
    expect(foldText("$120,000 &mdash; $150,000 &amp; equity&#8230;")).toBe(
      "$120,000 - $150,000 & equity...",
    );
  });
});

describe("enrichRequest", () => {
  it("sends a trimmed posting and verifies against what it sent", () => {
    const request = enrichRequest({
      title: "Senior Backend Engineer",
      company: "Acme",
      location: "Remote",
      description: `${POSTING}\n${"Legal notice. ".repeat(2000)}`,
    });
    expect(request.feature).toBe("enrich");
    const sent = request.content[0]!.text;
    expect(sent.length).toBeLessThan(13_000);
    expect(sent).toContain("<job_description>");
    const enrichment = request.finish(output());
    expect(enrichment.yearsMin).toBe(5);
  });
});

interface Sent {
  method: string;
  url: string;
  body: string;
}

/** OpenAI's Files and Batch endpoints, answered from memory. */
function fakeOpenAI(state: { status: string; output: string; errors: string }) {
  const sent: Sent[] = [];
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const client = new OpenAI({
    apiKey: "test-key",
    maxRetries: 0,
    fetch: async (input, init) => {
      // The SDK probes FormData support with a data: URL before uploading.
      if (String(input).startsWith("data:")) return new Response("");
      const url = new URL(String(input));
      // Uploads arrive as multipart bodies; reading them through a Request handles every form.
      const body = init?.body ? await new Request(url, init).text() : "";
      sent.push({ method: init?.method ?? "GET", url: url.pathname, body });
      if (url.pathname === "/v1/files") return json({ id: "file-in", object: "file" });
      if (url.pathname === "/v1/batches") return json({ id: "batch_1", status: "validating" });
      if (url.pathname === "/v1/batches/batch_1") {
        return json({
          id: "batch_1",
          status: state.status,
          output_file_id: state.output ? "file-out" : null,
          error_file_id: state.errors ? "file-err" : null,
        });
      }
      if (url.pathname === "/v1/files/file-out/content") return new Response(state.output);
      if (url.pathname === "/v1/files/file-err/content") return new Response(state.errors);
      return new Response("not found", { status: 404 });
    },
  });
  return { client, sent };
}

const responseBody = (text: string) => ({
  id: "resp_1",
  object: "response",
  model: "gpt-4o-mini-2024-07-18",
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    },
  ],
  incomplete_details: null,
  usage: {
    input_tokens: 2000,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 300,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 2300,
  },
});

describe("OpenAIRequestBatches", () => {
  const job = {
    title: "Senior Backend Engineer",
    company: "Acme",
    location: "Remote",
    description: POSTING,
  };

  it("uploads the requests as JSONL and reads each result back, at batch price", async () => {
    const state = { status: "in_progress", output: "", errors: "" };
    const { client, sent } = fakeOpenAI(state);
    const batches = new OpenAIRequestBatches(
      new OpenAIProvider(
        () => "gpt-4o-mini",
        () => client,
      ),
      () => client,
    );
    const request = enrichRequest(job) as unknown as AnyFeatureRequest;
    expect(
      await batches.submit([
        { id: "job-1", request },
        { id: "job-2", request },
      ]),
    ).toBe("batch_1");

    const [upload, create] = sent;
    expect(upload!.body).toMatch(/name="purpose"\r?\n\r?\nbatch/);
    const lines = upload!.body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('{"custom_id"'))
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      custom_id: "job-1",
      method: "POST",
      url: "/v1/responses",
      body: {
        model: "gpt-4o-mini",
        store: false,
        text: { format: { type: "json_schema", name: "result", strict: true } },
      },
    });
    // gpt-4o-mini doesn't reason; nothing identifies a user.
    expect(lines[0].body).not.toHaveProperty("reasoning");
    expect(lines[0].body).not.toHaveProperty("prompt_cache_key");
    expect(JSON.parse(create!.body)).toEqual({
      input_file_id: "file-in",
      endpoint: "/v1/responses",
      completion_window: "24h",
    });

    expect(await batches.isDone("batch_1")).toBe(false);
    state.status = "completed";
    expect(await batches.isDone("batch_1")).toBe(true);

    state.output = [
      {
        custom_id: "job-1",
        response: { status_code: 200, body: responseBody(JSON.stringify(output())) },
        error: null,
      },
      {
        custom_id: "job-2",
        response: { status_code: 400, body: { error: { message: "Invalid schema" } } },
        error: null,
      },
      {
        custom_id: "someone-else",
        response: { status_code: 200, body: responseBody("{}") },
        error: null,
      },
    ]
      .map((line) => JSON.stringify(line))
      .join("\n");
    state.errors = JSON.stringify({
      custom_id: "job-3",
      response: null,
      error: {
        code: "batch_expired",
        message: "This request could not be executed before the completion window expired.",
      },
    });

    const usage: UsageRecord[] = [];
    const ctx = { userId: null, onUsage: (record: UsageRecord) => void usage.push(record) };
    const known = new Set(["job-1", "job-2", "job-3"]);
    const results = new Map<string, unknown>();
    for await (const { id, result } of batches.results("batch_1", (id) =>
      known.has(id) ? { request, ctx } : undefined,
    )) {
      results.set(id, result);
    }
    expect([...results.keys()]).toEqual(["job-1", "job-2", "job-3"]);
    const first = results.get("job-1") as { status: string; output: JobEnrichment };
    expect(first.status).toBe("succeeded");
    expect(first.output).toMatchObject({ yearsMin: 5, contractTerms: ["w2"], sponsorship: "no" });
    expect(results.get("job-2")).toEqual({
      status: "failed",
      error: "Invalid schema",
      retryable: false,
    });
    expect(results.get("job-3")).toMatchObject({ status: "failed", retryable: true });
    // gpt-4o-mini at half price: 2,000 × $0.075 + 300 × $0.30 per million tokens.
    expect(usage).toEqual([
      expect.objectContaining({ feature: "enrich", batch: true, costMicroUsd: 240 }),
    ]);
  });
});

describe("enrichmentBatches", () => {
  it("runs on GPT-4o-mini when OpenAI is configured, and is off otherwise", () => {
    expect(enrichmentBatches({ OPENAI_API_KEY: "key" })).toMatchObject({
      model: "gpt-4o-mini",
      batches: { vendor: "openai" },
    });
    expect(enrichmentBatches({})).toBeNull();
    expect(enrichmentBatches({ OPENAI_API_KEY: "key", ENRICH_JOBS: "off" })).toBeNull();
    expect(enrichmentBatches({ OPENAI_API_KEY: "key", AI_PROVIDER: "mock" })).toBeNull();
  });

  it("follows its own route, not the one-model override", () => {
    expect(
      enrichmentBatches({ AI_ROUTE_ENRICH: "anthropic:claude-haiku-4-5", ANTHROPIC_API_KEY: "k" }),
    ).toMatchObject({ model: "claude-haiku-4-5", batches: { vendor: "anthropic" } });
    expect(enrichmentBatches({ OPENAI_API_KEY: "key", AI_MODEL: "claude-opus-5" })).toMatchObject({
      model: "gpt-4o-mini",
    });
  });
});
