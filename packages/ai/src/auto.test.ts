import Anthropic from "@anthropic-ai/sdk";
import { AiRefusalError, ExternalServiceError } from "@gettargetrole/core/errors";
import { SAMPLE_JOB_DESCRIPTION, SAMPLE_RESUME } from "@gettargetrole/resume/fixtures";
import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { mapAnthropicError } from "./client";
import { ModelUnavailableError } from "./errors";
import { MockProvider } from "./mock-provider";
import { mapOpenAIError } from "./openai-provider";
import { parseRoute, routeChain, RoutedProvider, type Route } from "./routing";
import type { AiProvider, StudioEvent } from "./types";
import verifiedRoutes from "./verified-routes.json" with { type: "json" };

const muse: Route = { vendor: "meta", model: "muse-ember-1.0" };
const luna: Route = { vendor: "openai", model: "gpt-6-luna" };
const sonnet: Route = { vendor: "anthropic", model: "claude-sonnet-5" };
const haiku: Route = { vendor: "anthropic", model: "claude-haiku-5-5" };

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

type Behaviour = Error | StudioEvent[] | "ok";

/** One fake provider per model; each call consumes the model's next behaviour (the last repeats). */
function models(plan: Record<string, Behaviour[]>) {
  const calls: string[] = [];
  const next = (model: string) => {
    calls.push(model);
    const queue = plan[model] ?? ["ok"];
    return queue.length > 1 ? queue.shift()! : queue[0]!;
  };
  const providerFor = (route: Route): AiProvider => {
    class Fake extends MockProvider {
      override async writeCoverLetter(
        ...args: Parameters<AiProvider["writeCoverLetter"]>
      ): ReturnType<AiProvider["writeCoverLetter"]> {
        const behaviour = next(route.model);
        if (behaviour instanceof Error) throw behaviour;
        const letter = await super.writeCoverLetter(...args);
        return { ...letter, body: route.model };
      }
      override async *studioChat(): AsyncGenerator<StudioEvent> {
        const behaviour = next(route.model);
        if (Array.isArray(behaviour)) yield* behaviour;
        else yield { type: "done", reply: route.model, changed: false };
      }
    }
    return new Fake();
  };
  return { calls, providerFor };
}

const all = { openai: true, meta: true };

function routed(
  plan: Record<string, Behaviour[]>,
  options: { chain?: Route[]; vendors?: { openai?: boolean; meta?: boolean } } = {},
) {
  const fake = models(plan);
  const clock = { now: 1_000_000 };
  const ai = new RoutedProvider(() => options.chain ?? [muse, luna, sonnet], {
    vendors: options.vendors ?? all,
    providerFor: fake.providerFor,
    now: () => clock.now,
  });
  const letter = async () => (await ai.writeCoverLetter(input, { userId: null })).body;
  return { ai, calls: fake.calls, clock, letter };
}

const down = () => new ModelUnavailableError("The AI service");
const badAnswer = () => new ExternalServiceError("The AI service");

async function collect(events: AsyncGenerator<StudioEvent>) {
  const seen: StudioEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

const studio = (ai: RoutedProvider) =>
  collect(ai.studioChat({ resume: SAMPLE_RESUME, history: [], message: "Hi" }, { userId: null }));

describe("the routes a feature tries", () => {
  it("uses the tested list, cheapest first, with Claude as the safety net", () => {
    const verified = { tailor: ["meta:muse-ember-1.0", "anthropic:claude-haiku-5-5"] };
    expect(routeChain("tailor", {}, verified)).toEqual([muse, haiku, sonnet]);
  });

  it("keeps today's routes until a test has listed others", () => {
    expect(routeChain("outreach", {}, {})).toEqual([haiku, sonnet]);
    expect(routeChain("cover_letter", {}, {})).toEqual([sonnet]);
    expect(routeChain("match", {}, {})).toEqual([luna, haiku]);
  });

  it("skips entries it can't use", () => {
    const verified = { outreach: ["meta:muse-ember-1.0-contributor", "azure:gpt-4o"] };
    expect(routeChain("outreach", {}, verified)).toEqual([haiku, sonnet]);
  });

  it("lets environment pins override the tested list", () => {
    const verified = { tailor: ["meta:muse-ember-1.0"] };
    expect(routeChain("tailor", { AI_ROUTE_TAILOR: "openai:gpt-6-luna" }, verified)).toEqual([
      luna,
      sonnet,
    ]);
    // A pinned Claude model is used alone, as before.
    expect(routeChain("tailor", { AI_MODEL: "claude-haiku-5-5" }, verified)).toEqual([haiku]);
  });

  it("ships a list in which every entry can be used", () => {
    for (const entry of Object.values(verifiedRoutes as Record<string, string[]>).flat()) {
      expect(parseRoute(entry), entry).not.toBeNull();
    }
  });
});

describe("auto mode", () => {
  it("moves to the next model when one is down or declines", async () => {
    const run = routed({
      [muse.model]: [down()],
      [luna.model]: [new AiRefusalError()],
    });
    await expect(run.letter()).resolves.toBe(sonnet.model);
    expect(run.calls).toEqual([muse.model, luna.model, sonnet.model]);
  });

  it("skips vendors that have no key", async () => {
    const run = routed({}, { vendors: { openai: false, meta: false } });
    await expect(run.letter()).resolves.toBe(sonnet.model);
    expect(run.calls).toEqual([sonnet.model]);
  });

  it("rests a model that was down for a minute", async () => {
    const run = routed({ [muse.model]: [down(), "ok"] });
    await run.letter();
    run.clock.now += 59_000;
    await expect(run.letter()).resolves.toBe(luna.model);
    expect(run.ai.modelFor("cover_letter")).toBe(luna.model);
    run.clock.now += 2_000;
    await expect(run.letter()).resolves.toBe(muse.model);
  });

  it("doesn't rest a model over one bad answer", async () => {
    const run = routed({ [muse.model]: [badAnswer(), "ok"] });
    await run.letter();
    await expect(run.letter()).resolves.toBe(muse.model);
  });

  it("still tries resting models when nothing else works", async () => {
    const run = routed(
      { [muse.model]: [down(), "ok"], [sonnet.model]: [down()] },
      { chain: [muse, sonnet] },
    );
    await expect(run.letter()).rejects.toThrow(ModelUnavailableError);
    await expect(run.letter()).resolves.toBe(muse.model);
  });

  it("doesn't switch models over a fault of our own", async () => {
    const run = routed({ [muse.model]: [new TypeError("bug")] });
    await expect(run.letter()).rejects.toThrow("bug");
    expect(run.calls).toEqual([muse.model]);
  });

  it("stops when the user cancels", async () => {
    const run = routed({ [muse.model]: [badAnswer()] });
    const controller = new AbortController();
    controller.abort();
    await expect(
      run.ai.writeCoverLetter(input, { userId: null, signal: controller.signal }),
    ).rejects.toThrow(ExternalServiceError);
    expect(run.calls).toEqual([muse.model]);
  });

  it("moves Studio to the next model if one fails before replying, and rests it", async () => {
    const run = routed({
      [muse.model]: [[{ type: "error", message: "busy", unavailable: true }]],
    });
    await expect(studio(run.ai)).resolves.toEqual([
      { type: "done", reply: luna.model, changed: false },
    ]);
    await studio(run.ai);
    expect(run.calls).toEqual([muse.model, luna.model, luna.model]);
  });

  it("keeps a Studio reply that has started, even if it then fails", async () => {
    const run = routed({
      [muse.model]: [
        [
          { type: "text", text: "Sure" },
          { type: "error", message: "cut off", unavailable: true },
        ],
      ],
    });
    await expect(studio(run.ai)).resolves.toEqual([
      { type: "text", text: "Sure" },
      { type: "error", message: "cut off" },
    ]);
    expect(run.calls).toEqual([muse.model]);
  });

  it("shows the last model's Studio error", async () => {
    const run = routed(
      { [sonnet.model]: [[{ type: "error", message: "busy", unavailable: true }]] },
      { chain: [sonnet] },
    );
    await expect(studio(run.ai)).resolves.toEqual([{ type: "error", message: "busy" }]);
  });
});

describe("which failures mean a model is unavailable", () => {
  const headers = new Headers();

  it("counts limits, outages and rejected keys, not bad requests", () => {
    for (const error of [
      new OpenAI.RateLimitError(429, {}, "slow down", headers),
      new OpenAI.InternalServerError(500, {}, "oops", headers),
      new OpenAI.AuthenticationError(401, {}, "bad key", headers),
      new OpenAI.NotFoundError(404, {}, "no such model", headers),
      new OpenAI.APIConnectionError({ message: "offline" }),
    ]) {
      expect(mapOpenAIError(error), error.constructor.name).toBeInstanceOf(ModelUnavailableError);
    }
    for (const error of [
      new Anthropic.RateLimitError(429, {}, "slow down", headers),
      new Anthropic.InternalServerError(529, {}, "overloaded", headers),
      new Anthropic.AuthenticationError(401, {}, "bad key", headers),
      new Anthropic.NotFoundError(404, {}, "no such model", headers),
      new Anthropic.APIConnectionError({ message: "offline" }),
    ]) {
      expect(mapAnthropicError(error), error.constructor.name).toBeInstanceOf(
        ModelUnavailableError,
      );
    }
    for (const mapped of [
      mapOpenAIError(new OpenAI.BadRequestError(400, {}, "bad", headers)),
      mapAnthropicError(new Anthropic.BadRequestError(400, {}, "bad", headers)),
    ]) {
      expect(mapped).toBeInstanceOf(ExternalServiceError);
      expect(mapped).not.toBeInstanceOf(ModelUnavailableError);
    }
  });
});
