import { createLogger } from "@gettargetrole/core/logger";
import { companies, getDb, jobs, type Database } from "@gettargetrole/db";
import { and, eq, isNull } from "drizzle-orm";
import { trackBoard } from "./companies";

const log = createLogger("feeds");

/** A feed of many employers' jobs, read like one board when its keys are set. */
export interface FeedSource {
  provider: "usajobs" | "adzuna";
  token: string;
  name: string;
  website: string;
  /** Environment variables it needs; without all of them it's off. */
  keys: readonly string[];
}

const USAJOBS_KEYS = ["USAJOBS_API_KEY", "USAJOBS_EMAIL"];
const ADZUNA_KEYS = ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"];

/**
 * USAJOBS: federal IT, computer science, computer engineering and data science jobs (series
 * 2210, 1550, 0854 and 1560). Adzuna: US IT jobs, with contracts read on their own so the
 * newest permanent roles don't crowd them out of a sync.
 */
export const FEED_SOURCES: readonly FeedSource[] = [
  {
    provider: "usajobs",
    token: "2210;1550;0854;1560",
    name: "USAJOBS (federal tech jobs)",
    website: "https://www.usajobs.gov/",
    keys: USAJOBS_KEYS,
  },
  {
    provider: "adzuna",
    token: "us|it-jobs|",
    name: "Adzuna (US IT jobs)",
    website: "https://www.adzuna.com/",
    keys: ADZUNA_KEYS,
  },
  {
    provider: "adzuna",
    token: "us|it-jobs|contract",
    name: "Adzuna (US IT contracts)",
    website: "https://www.adzuna.com/",
    keys: ADZUNA_KEYS,
  },
];

/** Why a feed is off, which is also how the worker knows to turn it back on. */
export const FEED_KEYS_MISSING = "Off: its API keys aren't set";

/**
 * Starts reading each feed whose keys are set, and stops reading each one whose keys aren't,
 * closing its jobs: a feed's terms can require its jobs to come down when access ends. A feed
 * an admin turned off stays off. Returns the feeds added, which need a first sync.
 */
export async function ensureFeedSources(
  env: NodeJS.ProcessEnv = process.env,
  db: Database = getDb(),
): Promise<string[]> {
  const added: string[] = [];
  for (const feed of FEED_SOURCES) {
    const board = and(eq(companies.ats, feed.provider), eq(companies.boardToken, feed.token));
    if (feed.keys.every((key) => env[key]?.trim())) {
      const { id, created } = await trackBoard(
        { name: feed.name, provider: feed.provider, token: feed.token, website: feed.website },
        db,
      );
      if (created) {
        added.push(id);
        continue;
      }
      const [restored] = await db
        .update(companies)
        .set({ active: true, lastSyncStatus: null, lastSyncError: null, syncFailures: 0 })
        .where(
          and(board, eq(companies.active, false), eq(companies.lastSyncError, FEED_KEYS_MISSING)),
        )
        .returning({ id: companies.id });
      if (restored) added.push(restored.id);
      continue;
    }
    const [stopped] = await db
      .update(companies)
      .set({ active: false, lastSyncStatus: "error", lastSyncError: FEED_KEYS_MISSING })
      .where(and(board, eq(companies.active, true)))
      .returning({ id: companies.id });
    if (!stopped) continue;
    const closed = await db
      .update(jobs)
      .set({ closedAt: new Date() })
      .where(and(eq(jobs.companyId, stopped.id), isNull(jobs.closedAt)))
      .returning({ id: jobs.id });
    log.warn({ feed: feed.name, closed: closed.length }, "feed turned off: its keys aren't set");
  }
  if (added.length > 0) log.info({ feeds: added.length }, "feeds turned on");
  return added;
}
