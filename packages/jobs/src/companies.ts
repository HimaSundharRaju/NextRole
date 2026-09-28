import { createLogger } from "@gettargetrole/core/logger";
import {
  companies,
  companyRequests,
  getDb,
  slugify,
  type AtsProvider,
  type CompanyRequestStatus,
  type Database,
} from "@gettargetrole/db";
import { and, eq, sql } from "drizzle-orm";
import { boardFetch } from "./connectors";
import { getJson } from "./connectors/http";
import type { Fetcher } from "./connectors/types";
import { discoverBoard } from "./discovery";

const log = createLogger("discovery");

/**
 * Starts tracking a job board. Returns the new company, or the one already tracking the board.
 * A name another company already has gets the provider added to its slug.
 */
export async function trackBoard(
  input: { name: string; provider: AtsProvider; token: string; website?: string },
  db: Database = getDb(),
): Promise<{ id: string; created: boolean }> {
  const base = slugify(input.name) || slugify(`${input.provider}-${input.token}`);
  for (const slug of [base, `${base}-${input.provider}`, `${base}-${Date.now().toString(36)}`]) {
    const [created] = await db
      .insert(companies)
      .values({
        name: input.name,
        slug,
        ats: input.provider,
        boardToken: input.token,
        website: input.website ?? "",
        // Bullhorn makes software for staffing firms, so its boards list clients' roles.
        isStaffingAgency: input.provider === "bullhorn",
      })
      .onConflictDoNothing()
      .returning({ id: companies.id });
    if (created) return { id: created.id, created: true };
    const [existing] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.ats, input.provider), eq(companies.boardToken, input.token)))
      .limit(1);
    if (existing) return { id: existing.id, created: false };
  }
  throw new Error(`Couldn't add ${input.name}`);
}

/** A request another run is already looking up is left alone for this long. */
const CLAIM_MINUTES = 10;

type RequestRow = typeof companyRequests.$inferSelect;

/**
 * Claims the next pending request, people's before public lists', oldest first. Another run
 * leaves a claimed request alone; one a run gave up on midway is claimable again after ten
 * minutes.
 */
async function claimNext(db: Database): Promise<RequestRow | null> {
  const result = await db.execute<{ id: string }>(sql`
    update ${companyRequests} set claimed_at = now()
    where id = (
      select id from ${companyRequests}
      where status = 'pending'
        and (claimed_at is null or claimed_at < now() - make_interval(mins => ${CLAIM_MINUTES}))
      order by case when source = 'yc' then 1 else 0 end, created_at
      limit 1
      for update skip locked
    )
    returning id`);
  const id = result.rows[0]?.id;
  if (!id) return null;
  const [row] = await db.select().from(companyRequests).where(eq(companyRequests.id, id));
  return row ?? null;
}

async function settle(
  db: Database,
  id: string,
  status: CompanyRequestStatus,
  companyId: string | null,
  note: string,
): Promise<void> {
  await db
    .update(companyRequests)
    .set({ status, companyId, note })
    .where(eq(companyRequests.id, id));
}

/**
 * Looks up pending company requests, adding each job board it finds. Returns the companies it
 * added, which need a first sync.
 */
export async function resolveCompanyRequests(
  options: { limit?: number; db?: Database; fetch?: Fetcher } = {},
): Promise<{ resolved: number; added: string[] }> {
  const db = options.db ?? getDb();
  const context = { fetch: options.fetch ?? boardFetch };
  const added: string[] = [];
  let resolved = 0;
  for (let i = 0; i < (options.limit ?? 25); i++) {
    const request = await claimNext(db);
    if (!request) break;
    try {
      const board = await discoverBoard({ name: request.name, url: request.url }, context);
      if (!board) {
        await settle(db, request.id, "not_found", null, "No job board we can read was found.");
      } else {
        const company = await trackBoard(
          {
            name: request.name || board.suggestedName,
            provider: board.provider,
            token: board.token,
            website: /^https:\/\//.test(request.url) ? new URL(request.url).origin : "",
          },
          db,
        );
        if (company.created) added.push(company.id);
        await settle(
          db,
          request.id,
          company.created ? "added" : "tracked",
          company.id,
          company.created ? `${board.openJobs} open jobs` : "",
        );
      }
      resolved++;
    } catch (error) {
      // Left pending; it's claimable again after the claim lapses.
      log.warn({ requestId: request.id, err: error }, "company request lookup failed");
    }
  }
  if (resolved > 0) log.info({ resolved, added: added.length }, "company requests resolved");
  return { resolved, added };
}

interface YcCompany {
  name?: string;
  website?: string;
  isHiring?: boolean;
  status?: string;
}

export const YC_HIRING_URL = "https://yc-oss.github.io/api/companies/hiring.json";

/**
 * Queues Y Combinator companies that are hiring and not tracked or queued yet, from the public
 * yc-oss list, as requests for discovery. Returns how many were queued.
 */
export async function importYcCompanies(
  options: { db?: Database; fetch?: Fetcher } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const list = await getJson<YcCompany[]>(
    YC_HIRING_URL,
    { fetch: options.fetch ?? boardFetch },
    { timeoutMs: 60_000 },
  );
  const known = new Set(
    [
      ...(await db.select({ name: companies.name }).from(companies)),
      ...(await db
        .select({ name: companyRequests.name })
        .from(companyRequests)
        .where(eq(companyRequests.source, "yc"))),
    ].map((row) => row.name.toLowerCase()),
  );
  const fresh = new Map<string, { source: "yc"; name: string; url: string }>();
  for (const company of list) {
    const name = company.name?.trim();
    if (!name || company.isHiring === false || company.status === "Inactive") continue;
    if (known.has(name.toLowerCase())) continue;
    const url = /^https?:\/\//.test(company.website ?? "") ? company.website! : "";
    fresh.set(name.toLowerCase(), { source: "yc", name, url });
  }
  const rows = [...fresh.values()];
  for (let offset = 0; offset < rows.length; offset += 500) {
    await db.insert(companyRequests).values(rows.slice(offset, offset + 500));
  }
  log.info({ queued: rows.length, listed: list.length }, "YC companies queued");
  return rows.length;
}
