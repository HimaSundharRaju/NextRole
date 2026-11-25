/*
 * How the model check decides: a premium model that clearly beats the reference sets the bar,
 * a model passes only if it ties the bar, and the passing models become the verified list.
 */
import type { JudgeId } from "./judge";

export interface Tally {
  win: number;
  tie: number;
  loss: number;
}

export type Judged = Record<JudgeId, Tally>;

export interface Scores {
  /** Items that failed an automatic check. */
  failures: number;
  /** The job's skills the candidate has that the outputs kept; null where it isn't measured. */
  covered: number | null;
  avgMs: number;
  /** The judges' verdicts against the model it was compared with, from this model's side. */
  judged: Judged;
}

/** People wait on these features, so a route must answer this fast on average. */
export const MAX_AVG_MS = 30_000;

const noWorse = (model: Scores, other: Scores) =>
  model.failures <= other.failures &&
  (model.covered ?? 0) >= (other.covered ?? 0) &&
  model.avgMs <= MAX_AVG_MS;

/** Whether every judge has given verdicts and each passes the test. */
const everyJudge = (judged: Judged, test: (tally: Tally) => boolean) =>
  Object.values(judged).every((tally) => tally.win + tally.tie + tally.loss > 0 && test(tally));

/** No worse than the bar on checks, job skills and speed, and each judge likes it as much. */
export function tiesBar(model: Scores, bar: Scores): boolean {
  return noWorse(model, bar) && everyJudge(model.judged, (tally) => tally.win >= tally.loss);
}

/**
 * The premium model that sets the bar: no worse than the reference and preferred to it by each
 * judge more often than not, by the widest margin. Null when the reference stays the bar.
 */
export function barFrom<T extends Scores>(reference: Scores, premiums: T[]): T | null {
  const margin = (model: Scores) =>
    Object.values(model.judged).reduce((sum, tally) => sum + tally.win - tally.loss, 0);
  const clear = premiums.filter(
    (model) =>
      noWorse(model, reference) && everyJudge(model.judged, (tally) => tally.win > tally.loss),
  );
  return clear.sort((a, b) => margin(b) - margin(a))[0] ?? null;
}

/** The models that passed, cheapest first, as `vendor:model` routes. */
export function verifiedList(
  rows: Array<{ vendor: string; model: string; eligible: boolean; costPerSuccessMicro: number }>,
): string[] {
  return rows
    .filter((row) => row.eligible)
    .sort((a, b) => a.costPerSuccessMicro - b.costPerSuccessMicro)
    .map((row) => `${row.vendor}:${row.model}`);
}
