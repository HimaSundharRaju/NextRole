import { inferWorkplaceType, parseSalaryFromText } from "../normalize";
import { htmlToText } from "../sanitize";
import { getJson } from "./http";
import type { BoardConnector, ConnectorContext, NormalizedJob } from "./types";

// The JSON API behind every Workday careers site: POST <site>/jobs lists postings 20 at a time,
// GET <site><externalPath> returns one posting with its description.

interface WorkdayPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  timeType?: string;
}

interface WorkdayFacetValue {
  descriptor: string;
  id: string;
  count: number;
}

interface WorkdayFacet {
  facetParameter: string;
  values?: Array<WorkdayFacetValue | WorkdayFacet>;
}

interface WorkdayList {
  total: number;
  jobPostings?: WorkdayPosting[];
  facets?: WorkdayFacet[];
}

interface WorkdayDetail {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    startDate?: string;
    timeType?: string;
    remoteType?: string;
    externalUrl?: string;
    country?: { descriptor?: string };
    jobRequisitionLocation?: { country?: { descriptor?: string; alpha2Code?: string } };
  };
}

interface WorkdayBoard {
  host: string;
  tenant: string;
  site: string;
}

const PAGE_SIZE = 20;
/** Workday returns at most 2,000 results per search; later pages start over from the first. */
export const WORKDAY_SEARCH_CAP = 2000;
/** A listing this close to the board's own count is complete; facet counts lag a little. */
const COMPLETE_SHARE = 0.98;
const DAY_MS = 86_400_000;

/** Tokens are `host|tenant|site`, e.g. `nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite`. */
export function parseWorkdayToken(token: string): WorkdayBoard {
  const [host = "", tenant = "", site = ""] = token.split("|");
  if (!host || !tenant || !site) {
    throw new Error(`A Workday board token is host|tenant|site, got "${token}"`);
  }
  return { host, tenant, site };
}

const apiBase = ({ host, tenant, site }: WorkdayBoard) =>
  `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`;

/** The public careers site; myworkdaysite.com hosts serve it under /recruiting/<tenant>. */
function siteBase({ host, tenant, site }: WorkdayBoard): string {
  return host.endsWith("myworkdaysite.com")
    ? `https://${host}/recruiting/${tenant}/${site}`
    : `https://${host}/${site}`;
}

/** "Posted Today", "Posted 3 Days Ago", "Posted 30+ Days Ago": approximate, from the listing. */
export function parsePostedOn(text: string | undefined, now = new Date()): Date | null {
  if (!text) return null;
  if (/today/i.test(text)) return now;
  if (/yesterday/i.test(text)) return new Date(now.getTime() - DAY_MS);
  const days = /(\d+)\+?\s+days?\s+ago/i.exec(text);
  return days ? new Date(now.getTime() - Number(days[1]) * DAY_MS) : null;
}

export function mapWorkdayPosting(
  board: WorkdayBoard,
  posting: WorkdayPosting,
  now = new Date(),
): NormalizedJob {
  // "5 Locations" names none of them; the details list them all.
  const location = /^\d+ locations?$/i.test(posting.locationsText ?? "")
    ? ""
    : (posting.locationsText ?? "");
  return {
    // The last path segment is Workday's own posting id ("Title-Slug_JR1997726").
    externalId: posting.externalPath.split("/").pop() || posting.externalPath,
    title: posting.title.trim(),
    department: "",
    location,
    workplaceType: inferWorkplaceType([location]),
    employmentType: posting.timeType ?? "",
    descriptionHtml: "",
    applyUrl: `${siteBase(board)}${posting.externalPath}`,
    postedAt: parsePostedOn(posting.postedOn, now),
    salary: null,
    needsHydration: true,
    ref: posting.externalPath,
  };
}

/** Facets whose values are plain counts, including those nested inside facet groups. */
function flatFacets(
  facets: WorkdayFacet[],
): Array<{ parameter: string; values: WorkdayFacetValue[] }> {
  const out: Array<{ parameter: string; values: WorkdayFacetValue[] }> = [];
  for (const facet of facets) {
    const values = facet.values ?? [];
    const plain = values.filter(
      (value): value is WorkdayFacetValue => "id" in value && typeof value.count === "number",
    );
    if (plain.length > 0 && plain.length === values.length) {
      out.push({ parameter: facet.facetParameter, values: plain });
    } else {
      out.push(
        ...flatFacets(values.filter((value): value is WorkdayFacet => "facetParameter" in value)),
      );
    }
  }
  return out;
}

const sumOf = (values: WorkdayFacetValue[]) => values.reduce((total, v) => total + v.count, 0);

async function search(
  board: WorkdayBoard,
  context: ConnectorContext,
  appliedFacets: Record<string, string[]>,
  offset: number,
): Promise<WorkdayList> {
  return getJson<WorkdayList>(`${apiBase(board)}/jobs`, context, {
    body: { appliedFacets, limit: PAGE_SIZE, offset, searchText: "" },
  });
}

/** Every posting one search finds, up to Workday's cap; the first page is already fetched. */
async function allPages(
  board: WorkdayBoard,
  context: ConnectorContext,
  appliedFacets: Record<string, string[]>,
  first: WorkdayList,
  total: number,
): Promise<WorkdayPosting[]> {
  const postings = [...(first.jobPostings ?? [])];
  for (let offset = PAGE_SIZE; offset < Math.min(total, WORKDAY_SEARCH_CAP); offset += PAGE_SIZE) {
    const page = (await search(board, context, appliedFacets, offset)).jobPostings ?? [];
    postings.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return postings;
}

export const workday: BoardConnector = {
  provider: "workday",
  boardUrl: (token) => siteBase(parseWorkdayToken(token)),
  // Big boards list thousands of jobs; a sync hydrates up to this many new ones.
  hydrationsPerSync: 250,
  async countJobs(token, context) {
    return (await search(parseWorkdayToken(token), context, {}, 0)).total;
  },
  async listJobs(token, context) {
    const board = parseWorkdayToken(token);
    const now = new Date();
    const first = await search(board, context, {}, 0);
    if (first.total < WORKDAY_SEARCH_CAP) {
      const postings = await allPages(board, context, {}, first, first.total);
      const jobs = postings.map((posting) => mapWorkdayPosting(board, posting, now));
      return { jobs, complete: jobs.length >= first.total };
    }

    // Past the cap, search one value of a facet at a time: the facet with the widest coverage
    // whose values each fit under the cap (usually the job family). A facet covering fewer
    // jobs than one capped search is no help.
    const facets = flatFacets(first.facets ?? []);
    const partition = facets
      .filter(
        (facet) =>
          sumOf(facet.values) >= WORKDAY_SEARCH_CAP &&
          facet.values.every((value) => value.count < WORKDAY_SEARCH_CAP),
      )
      .sort((a, b) => sumOf(b.values) - sumOf(a.values))[0];
    // Each job has one time type, so its counts add up to the board's real size.
    const timeType = facets.find((facet) => facet.parameter === "timeType");
    const expected = timeType ? sumOf(timeType.values) : partition ? sumOf(partition.values) : 0;
    if (!partition) {
      const postings = await allPages(board, context, {}, first, WORKDAY_SEARCH_CAP);
      return {
        jobs: postings.map((posting) => mapWorkdayPosting(board, posting, now)),
        complete: false,
      };
    }
    const byPath = new Map<string, WorkdayPosting>();
    for (const value of partition.values) {
      const applied = { [partition.parameter]: [value.id] };
      const page = await search(board, context, applied, 0);
      for (const posting of await allPages(board, context, applied, page, value.count)) {
        byPath.set(posting.externalPath, posting);
      }
    }
    const jobs = [...byPath.values()].map((posting) => mapWorkdayPosting(board, posting, now));
    return { jobs, complete: expected > 0 && jobs.length >= expected * COMPLETE_SHARE };
  },
  async hydrate(token, job, context) {
    const board = parseWorkdayToken(token);
    const detail = await getJson<WorkdayDetail>(`${apiBase(board)}${job.ref}`, context);
    const info = detail.jobPostingInfo ?? {};
    const locations = [info.location, ...(info.additionalLocations ?? [])].filter(
      (value): value is string => Boolean(value),
    );
    const html = info.jobDescription ?? "";
    const text = htmlToText(html);
    const country = info.jobRequisitionLocation?.country;
    return {
      ...job,
      title: info.title?.trim() || job.title,
      location: locations.join(" / ") || job.location,
      workplaceType: inferWorkplaceType([info.remoteType, ...locations, text.slice(0, 600)]),
      employmentType: info.timeType ?? job.employmentType,
      descriptionHtml: html,
      applyUrl: info.externalUrl ?? job.applyUrl,
      postedAt: info.startDate ? new Date(info.startDate) : job.postedAt,
      salary: parseSalaryFromText(text),
      placeHints: [
        { country: country?.alpha2Code ?? country?.descriptor ?? info.country?.descriptor },
      ],
      needsHydration: false,
    };
  },
};
