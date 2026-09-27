import type { AtsProvider } from "@gettargetrole/db/schema";
import { getConnector } from "./connectors";
import { USER_AGENT } from "./connectors/http";
import type { ConnectorContext } from "./connectors/types";
import { decodeEntities } from "./sanitize";

/*
 * Finding a company's job board from what a user or a public list gives us: a link, a careers
 * page, a website or just a name.
 */

export interface DetectedBoard {
  provider: AtsProvider;
  token: string;
}

export interface DiscoveredBoard extends DetectedBoard {
  /** Open jobs when the board was checked. */
  openJobs: number;
  /** A name for the company, when the request didn't give one. */
  suggestedName: string;
}

const LOCALE = /^[a-z]{2}(?:-[a-z]{2})?$/i;

/**
 * The job board a URL points at, from the address alone: a careers page hosted by an ATS, one
 * of their APIs, or an embed. Null for anything else, such as a company's own careers site.
 */
export function detectBoard(input: string): DetectedBoard | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [first = "", second = "", third = "", fourth = ""] = path;

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const token = first === "embed" ? url.searchParams.get("for") : first;
    return token ? { provider: "greenhouse", token } : null;
  }
  if (host === "boards-api.greenhouse.io" && first === "v1" && second === "boards" && third) {
    return { provider: "greenhouse", token: third };
  }
  if (host === "jobs.lever.co" && first) return { provider: "lever", token: first };
  if (host === "api.lever.co" && second === "postings" && third) {
    return { provider: "lever", token: third };
  }
  if (host === "jobs.ashbyhq.com" && first) return { provider: "ashby", token: first };
  if (host === "api.ashbyhq.com" && second === "job-board" && third) {
    return { provider: "ashby", token: third };
  }
  if ((host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") && first) {
    return { provider: "smartrecruiters", token: first };
  }
  if (host.endsWith(".myworkdayjobs.com")) {
    // The API (/wday/cxs/<tenant>/<site>) or the site (/[locale/]<site>).
    if (first === "wday" && second === "cxs" && third && fourth) {
      return { provider: "workday", token: `${host}|${third}|${fourth}` };
    }
    const site = LOCALE.test(first) ? second : first;
    const tenant = host.split(".")[0];
    return site && tenant ? { provider: "workday", token: `${host}|${tenant}|${site}` } : null;
  }
  if (host.endsWith(".myworkdaysite.com")) {
    const at = path.indexOf("recruiting");
    const [tenant, site] = at >= 0 ? path.slice(at + 1, at + 3) : [];
    return tenant && site ? { provider: "workday", token: `${host}|${tenant}|${site}` } : null;
  }
  if (host.endsWith(".oraclecloud.com")) {
    const at = path.indexOf("sites");
    const site = at >= 0 ? path[at + 1] : undefined;
    return site ? { provider: "oracle", token: `${host}|${site}` } : null;
  }
  if (host === "amazon.jobs" || host.endsWith(".amazon.jobs")) {
    return { provider: "amazon", token: "all" };
  }
  // Eightfold sites name their company domain in the link (…/careers?domain=netflix.com).
  const domain = url.searchParams.get("domain");
  if (domain && (host.endsWith(".eightfold.ai") || first === "careers")) {
    return { provider: "eightfold", token: `${host}|${domain.toLowerCase()}` };
  }
  return null;
}

const ATTRIBUTE_URL = /(?:href|src|action|data-url)\s*=\s*["']([^"']+)["']/gi;
const ATS_URL =
  /https?:\/\/[a-z0-9.-]+\.(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|myworkdaysite\.com|oraclecloud\.com)\/[^\s"'<>)\\]*/gi;

/** Job boards a page links to or embeds, in the order they appear. */
export function findBoardLinks(html: string, pageUrl: string): DetectedBoard[] {
  const found = new Map<string, DetectedBoard>();
  const add = (raw: string) => {
    try {
      const board = detectBoard(new URL(decodeEntities(raw), pageUrl).href);
      if (board) found.set(`${board.provider}|${board.token}`, board);
    } catch {
      // Not a URL.
    }
  };
  for (const match of html.matchAll(ATTRIBUTE_URL)) add(match[1]!);
  // Embeds set up in scripts rather than links.
  for (const match of html.matchAll(ATS_URL)) add(match[0]);
  return [...found.values()];
}

const ANCHOR = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const CAREERS =
  /\b(careers?|jobs|join (?:us|the team)|work (?:with|for) us|open (?:roles|positions))\b/i;

/** Links on a company's site that look like its careers page. */
export function findCareersLinks(html: string, pageUrl: string): string[] {
  const links = new Set<string>();
  for (const [, href = "", text = ""] of html.matchAll(ANCHOR)) {
    const label = text.replace(/<[^>]+>/g, " ");
    if (!CAREERS.test(label) && !/career|jobs/i.test(href)) continue;
    try {
      const url = new URL(decodeEntities(href), pageUrl);
      if (url.protocol === "https:" || url.protocol === "http:") links.add(url.href.split("#")[0]!);
    } catch {
      // Not a URL.
    }
  }
  return [...links].slice(0, 3);
}

/** Whether robots.txt lets this crawler fetch `path`; longest matching rule wins. */
export function robotsAllows(robotsTxt: string, path: string, agent = "gettargetrolebot"): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; pattern: string }> }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((group) =>
    group.agents.some((name) => name !== "*" && agent.includes(name)),
  );
  const rules = (mine.length ? mine : groups.filter((group) => group.agents.includes("*"))).flatMap(
    (group) => group.rules,
  );
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules) {
    const regex = new RegExp(
      `^${rule.pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$/, "$")}`,
    );
    if (!regex.test(path)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best ? best.allow : true;
}

const CORPORATE = new Set([
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "gmbh",
]);

/** Board names to try for a company: its name run together and hyphenated, and its site's name. */
export function slugCandidates(name: string, url = ""): string[] {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const core = words.filter((word, index) => index === 0 || !CORPORATE.has(word));
  const out = new Set<string>();
  if (core.length > 0) {
    out.add(core.join(""));
    out.add(core.join("-"));
  }
  try {
    const site = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
    if (site && !/^(careers?|jobs|apply|boards?)$/.test(site)) out.add(site);
  } catch {
    // No site.
  }
  return [...out].filter((slug) => slug.length >= 2).slice(0, 4);
}

/** ATSs whose boards can be found by guessing a name: public, cheap to check, unambiguous. */
const GUESSABLE: AtsProvider[] = ["ashby", "greenhouse", "lever"];

/** How many jobs a board has open, or null if it can't be read. */
async function openJobs(board: DetectedBoard, context: ConnectorContext): Promise<number | null> {
  const connector = getConnector(board.provider);
  try {
    return connector.countJobs
      ? await connector.countJobs(board.token, context)
      : (await connector.listJobs(board.token, context)).jobs.length;
  } catch {
    return null;
  }
}

const robotsCache = new Map<string, { text: string; at: number }>();
const ROBOTS_TTL_MS = 24 * 3600_000;
const MAX_PAGE_BYTES = 2_000_000;

/**
 * A page's text and where it ended up after redirects, if robots.txt allows it and it is of the
 * expected type (HTML, or JSON with `json`); null otherwise.
 */
async function fetchPage(
  url: string,
  context: ConnectorContext,
  { json = false }: { json?: boolean } = {},
): Promise<{ text: string; url: string } | null> {
  const target = new URL(url);
  const headers = { "user-agent": USER_AGENT, accept: json ? "application/json" : "text/html" };
  const signal = () =>
    context.signal
      ? AbortSignal.any([context.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000);
  try {
    let robots = robotsCache.get(target.origin);
    if (!robots || Date.now() - robots.at > ROBOTS_TTL_MS) {
      const response = await context.fetch(`${target.origin}/robots.txt`, {
        headers,
        signal: signal(),
      });
      // No robots.txt (or an unreadable one) means no rules.
      robots = { text: response.ok ? await response.text() : "", at: Date.now() };
      robotsCache.set(target.origin, robots);
    }
    if (!robotsAllows(robots.text, target.pathname + target.search)) return null;
    const response = await context.fetch(url, { headers, signal: signal() });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !(json ? /json/i : /html/i).test(type)) return null;
    const text = await response.text();
    return {
      text: text.length > MAX_PAGE_BYTES ? text.slice(0, MAX_PAGE_BYTES) : text,
      url: response.url || url,
    };
  } catch {
    return null;
  }
}

/**
 * Staffing firms' career portals built on Bullhorn's open-source portal keep their settings,
 * including the Bullhorn cluster and corp token, in an app.json next to the page.
 */
async function bullhornPortal(
  page: { text: string; url: string },
  context: ConnectorContext,
): Promise<DetectedBoard | null> {
  if (!/<app-root|career-portal/i.test(page.text)) return null;
  const directory = page.url.endsWith("/") ? page.url : `${page.url}/`;
  const base = new URL(/<base\s+href="([^"]*)"/i.exec(page.text)?.[1] ?? "./", directory);
  const settings = await fetchPage(new URL("app.json", base).href, context, { json: true });
  if (!settings) return null;
  try {
    const service = (JSON.parse(settings.text) as { service?: Record<string, unknown> }).service;
    const cluster = String(service?.swimlane ?? "");
    const corpToken = String(service?.corpToken ?? "");
    if (!/^\d+$/.test(cluster) || !/^[A-Za-z0-9]+$/.test(corpToken)) return null;
    const portal = `${base.host}${base.pathname}`.replace(/\/+$/, "");
    return { provider: "bullhorn", token: `${cluster}|${corpToken}|${portal}` };
  } catch {
    return null;
  }
}

/** Eightfold's own sites give themselves away in their page source. */
function eightfoldCandidates(html: string, pageUrl: string): DetectedBoard[] {
  if (!/eightfold/i.test(html)) return [];
  const host = new URL(pageUrl).hostname;
  const labels = host.split(".");
  const domains = new Set([labels.slice(-2).join("."), `${labels.at(-2)}.com`]);
  return [...domains].flatMap((domain) => [
    { provider: "eightfold" as const, token: `${host}|${domain}` },
    { provider: "eightfold" as const, token: `${host}|${domain}|pcsx` },
  ]);
}

const titleCase = (value: string) =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");

function nameFromBoard(board: DetectedBoard): string {
  if (board.provider === "amazon") return "Amazon";
  if (board.provider === "bullhorn") {
    // The portal's host names the firm: jobs.prestigestaffing.com is Prestigestaffing.
    const host = board.token.split("|")[2]?.split("/")[0] ?? "";
    return titleCase(
      host.split(".").find((label) => !/^(www|jobs|careers|apply|portal)$/.test(label)) ?? host,
    );
  }
  const [first = ""] = board.token.split("|");
  const part =
    board.provider === "workday" || board.provider === "oracle" || board.provider === "eightfold"
      ? (first
          .split(".")
          .find((label) => !/^(www|wd\d+|fa|jobs|careers|apply|explore)$/.test(label)) ?? first)
      : first;
  return titleCase(part);
}

/**
 * Finds the job board for a company. A link that is a board is checked directly; another page
 * (a careers page, or a website with a careers link) is read for the board it links to or
 * embeds; otherwise the company's name is tried as a board name on the ATSs that allow it. A
 * board found by guessing must have open jobs.
 */
export async function discoverBoard(
  request: { name: string; url: string },
  context: ConnectorContext,
): Promise<DiscoveredBoard | null> {
  const found = async (board: DetectedBoard, requireJobs: boolean) => {
    const count = await openJobs(board, context);
    if (count === null || (requireJobs && count === 0)) return null;
    return { ...board, openJobs: count, suggestedName: request.name || nameFromBoard(board) };
  };

  if (request.url) {
    const direct = detectBoard(request.url);
    if (direct) {
      // A link without its Eightfold API named works with either.
      const tries =
        direct.provider === "eightfold" && !direct.token.endsWith("|pcsx")
          ? [direct, { ...direct, token: `${direct.token}|pcsx` }]
          : [direct];
      for (const board of tries) {
        const result = await found(board, false);
        if (result) return result;
      }
    }
    const pages = [request.url];
    for (let index = 0; index < pages.length && index < 3; index++) {
      const page = await fetchPage(pages[index]!, context);
      if (!page) continue;
      for (const board of [
        ...findBoardLinks(page.text, page.url),
        ...eightfoldCandidates(page.text, page.url),
      ]) {
        const result = await found(board, board.provider === "eightfold");
        if (result) return result;
      }
      const portal = await bullhornPortal(page, context);
      if (portal) {
        const result = await found(portal, false);
        if (result) return result;
      }
      if (index === 0) pages.push(...findCareersLinks(page.text, page.url));
    }
  }

  for (const slug of slugCandidates(request.name, request.url)) {
    for (const provider of GUESSABLE) {
      const result = await found({ provider, token: slug }, true);
      if (result) return result;
    }
  }
  return null;
}
