/*
 * Blind pairwise judging. Each comparison goes to one judge from each vendor, so neither
 * vendor's models are graded only by their own. The order of A and B is randomized per item.
 */
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getAnthropic, textOf } from "../src/client";
import { estimateCostMicroUsd } from "../src/config";
import { getOpenAI, openAiUsage } from "../src/openai-provider";

export const JUDGES = [
  { id: "claude-judge", vendor: "anthropic", model: "claude-sonnet-5" },
  { id: "gpt-judge", vendor: "openai", model: "gpt-5-mini" },
] as const;
export type JudgeId = (typeof JUDGES)[number]["id"];

const verdictSchema = z.object({
  reasoning: z.string().describe("Two or three sentences comparing the outputs"),
  winner: z.enum(["A", "B", "tie"]),
});

const SYSTEM = `You judge two AI outputs produced for the same job seeker and the same task. Decide which output would serve the candidate better.

Judge, in order of importance:
1. Truthfulness: every claim must be supported by the candidate's resume. Inventing experience, employers, titles, dates, skills or numbers is the worst possible failure.
2. Relevance to the job and the task.
3. Specificity and evidence rather than generic statements.
4. Clarity, structure and professional tone.

Longer is not better. The outputs are labeled A and B in random order. Answer "tie" when neither is clearly better.`;

export interface Comparison {
  task: string;
  resume: string;
  job: string;
  candidate: string;
  reference: string;
  /** Deterministic order: when true, the candidate is shown as A. */
  candidateFirst: boolean;
}

export interface JudgeResult {
  judge: JudgeId;
  /** From the candidate's point of view. */
  outcome: "win" | "tie" | "loss";
  reasoning: string;
  costMicroUsd: number;
}

function prompt(comparison: Comparison): string {
  const [a, b] = comparison.candidateFirst
    ? [comparison.candidate, comparison.reference]
    : [comparison.reference, comparison.candidate];
  return [
    `<task>${comparison.task}</task>`,
    `<candidate_resume>\n${comparison.resume}\n</candidate_resume>`,
    comparison.job ? `<job>\n${comparison.job.slice(0, 5000)}\n</job>` : "",
    `<output_a>\n${a}\n</output_a>`,
    `<output_b>\n${b}\n</output_b>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function outcome(winner: "A" | "B" | "tie", candidateFirst: boolean): JudgeResult["outcome"] {
  if (winner === "tie") return "tie";
  return (winner === "A") === candidateFirst ? "win" : "loss";
}

export async function judge(judgeId: JudgeId, comparison: Comparison): Promise<JudgeResult> {
  const config = JUDGES.find((entry) => entry.id === judgeId)!;
  if (config.vendor === "anthropic") {
    const message = await getAnthropic().beta.messages.create({
      model: config.model,
      max_tokens: 4_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: betaZodOutputFormat(verdictSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt(comparison) }],
    });
    const verdict = verdictSchema.parse(JSON.parse(textOf(message)));
    return {
      judge: judgeId,
      outcome: outcome(verdict.winner, comparison.candidateFirst),
      reasoning: verdict.reasoning,
      costMicroUsd: estimateCostMicroUsd(config.model, {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      }),
    };
  }
  const response = await getOpenAI().responses.parse({
    model: config.model,
    store: false,
    reasoning: { effort: "low" },
    instructions: SYSTEM,
    input: prompt(comparison),
    text: { format: zodTextFormat(verdictSchema, "verdict") },
  });
  const verdict = verdictSchema.parse(response.output_parsed);
  return {
    judge: judgeId,
    outcome: outcome(verdict.winner, comparison.candidateFirst),
    reasoning: verdict.reasoning,
    costMicroUsd: openAiUsage("match", config.model, response).costMicroUsd,
  };
}
