import { jobs, type Seniority } from "@gettargetrole/db";
import { sql, type SQL } from "drizzle-orm";
import { IMPLIED_MIN_YEARS, postgresTitleRules } from "./seniority";

/*
 * The job board's "up to N years" filter, with a fallback for posts that state no years. Almost
 * none do, so the filter used to keep everything. `withinYears` (seniority.ts) is the TypeScript
 * twin of this, and the Postgres test checks that the two agree.
 */

/** The years for a level, as a literal in the query (they're constants, not input). */
const years = (level: Seniority) => sql.raw(String(IMPLIED_MIN_YEARS[level]));

/**
 * The years a job's level implies, or null when there is no level: the one enrichment read, else
 * the one the title's wording gives (the same rules, in the same order, as `seniorityFromTitle`).
 *
 * This runs on every open job, so it does as little as the limit allows: rules after the last one
 * that implies more than `maxYears` can only keep a job, so they are left out (a limit of 8 never
 * needs to look for "Senior").
 */
function impliedYears(maxYears: number): SQL {
  const fromEnrichment = sql.join(
    (Object.keys(IMPLIED_MIN_YEARS) as Seniority[]).map(
      (level) => sql`when ${level} then ${years(level)}`,
    ),
    sql` `,
  );
  const rules = postgresTitleRules();
  const last = rules.findLastIndex(({ level }) => IMPLIED_MIN_YEARS[level] > maxYears);
  const fromTitle = sql.join(
    rules
      .slice(0, last + 1)
      .map(({ level, pattern, unless }) =>
        unless
          ? sql`when ${jobs.title} ~* ${pattern} and ${jobs.title} !~* ${unless} then ${years(level)}`
          : sql`when ${jobs.title} ~* ${pattern} then ${years(level)}`,
      ),
    sql` `,
  );
  const titleCase = last < 0 ? sql`null` : sql`case ${fromTitle} end`;
  return sql`coalesce(case ${jobs.seniority} ${fromEnrichment} end, ${titleCase})`;
}

/**
 * A condition for jobs asking for at most `maxYears` years of experience. A post's own figure
 * decides; without one, the level read from the post or its title does; a post that says nothing
 * stays.
 */
export function withinMaxYears(maxYears: number): SQL {
  const limit = Math.trunc(maxYears);
  return sql`(${jobs.yearsMin} <= ${limit} or (${jobs.yearsMin} is null and coalesce(${impliedYears(limit)}, 0) <= ${limit}))`;
}
