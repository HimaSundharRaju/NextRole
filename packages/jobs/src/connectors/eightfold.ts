import { inferWorkplaceType, parseSalaryFromText } from "../normalize";
import { htmlToText } from "../sanitize";
import { getJson } from "./http";
import type { BoardConnector, NormalizedJob } from "./types";

// Eightfold careers sites (Netflix, Microsoft…) serve one of two JSON APIs: the older
// /api/apply/v2 or the newer /api/pcsx. Each site opens only one to the public, so the token
// names it. Both list 10 postings per page without descriptions.

interface ApplyPosition {
  id: number;
  name: string;
  location?: string;
  locations?: string[];
  department?: string;
  t_create?: number;
  work_location_option?: string | null;
  canonicalPositionUrl?: string;
}

interface ApplyList {
  count?: number;
  positions?: ApplyPosition[];
}

interface ApplyDetail {
  job_description?: string;
  canonicalPositionUrl?: string;
}

interface PcsxPosition {
  id: number;
  name: string;
  locations?: string[];
  standardizedLocations?: string[];
  department?: string;
  postedTs?: number;
  creationTs?: number;
  workLocationOption?: string | null;
  positionUrl?: string;
}

interface PcsxList {
  data?: { count?: number; positions?: PcsxPosition[] };
}

interface PcsxDetail {
  data?: {
    jobDescription?: string;
    publicUrl?: string;
    efcustomTextEmploymentType?: string[];
  };
}

interface EightfoldSite {
  host: string;
  domain: string;
  pcsx: boolean;
}

const PAGE_SIZE = 10;
const MAX_POSITIONS = 5000;

/** Tokens are `host|domain`, or `host|domain|pcsx` for sites on the newer API. */
export function parseEightfoldToken(token: string): EightfoldSite {
  const [host = "", domain = "", api = ""] = token.split("|");
  if (!host || !domain) {
    throw new Error(`An Eightfold board token is host|domain[|pcsx], got "${token}"`);
  }
  return { host, domain, pcsx: api === "pcsx" };
}

/** "onsite", "remote" or "hybrid", as Eightfold labels a position. */
function workplace(option: string | null | undefined, locations: string[]) {
  const labelled = option === "onsite" ? "onsite" : option === "remote" ? "remote" : undefined;
  return option === "hybrid" ? "hybrid" : inferWorkplaceType(locations, labelled);
}

const fromEpoch = (seconds: number | undefined) =>
  seconds && seconds > 0 ? new Date(seconds * 1000) : null;

export function mapApplyPosition(site: EightfoldSite, position: ApplyPosition): NormalizedJob {
  const locations = position.locations?.length
    ? position.locations
    : [position.location ?? ""].filter(Boolean);
  return {
    externalId: String(position.id),
    title: position.name.trim(),
    department: position.department ?? "",
    location: locations.join(" / "),
    workplaceType: workplace(position.work_location_option, locations),
    employmentType: "",
    descriptionHtml: "",
    applyUrl: position.canonicalPositionUrl ?? `https://${site.host}/careers/job/${position.id}`,
    postedAt: fromEpoch(position.t_create),
    salary: null,
    needsHydration: true,
  };
}

export function mapPcsxPosition(site: EightfoldSite, position: PcsxPosition): NormalizedJob {
  const locations = position.standardizedLocations?.length
    ? position.standardizedLocations
    : (position.locations ?? []);
  return {
    externalId: String(position.id),
    title: position.name.trim(),
    department: position.department ?? "",
    location: locations.join(" / "),
    workplaceType: workplace(position.workLocationOption, locations),
    employmentType: "",
    descriptionHtml: "",
    applyUrl: `https://${site.host}${position.positionUrl ?? `/careers/job/${position.id}`}`,
    postedAt: fromEpoch(position.postedTs ?? position.creationTs),
    salary: null,
    needsHydration: true,
  };
}

function withDescription(job: NormalizedJob, html: string, applyUrl?: string): NormalizedJob {
  const text = htmlToText(html);
  return {
    ...job,
    descriptionHtml: html,
    applyUrl: applyUrl ?? job.applyUrl,
    workplaceType:
      job.workplaceType === "unknown"
        ? inferWorkplaceType([job.location, text.slice(0, 600)])
        : job.workplaceType,
    salary: parseSalaryFromText(text),
    needsHydration: false,
  };
}

export const eightfold: BoardConnector = {
  provider: "eightfold",
  boardUrl: (token) => {
    const site = parseEightfoldToken(token);
    return `https://${site.host}/careers?domain=${encodeURIComponent(site.domain)}`;
  },
  hydrationsPerSync: 250,
  async countJobs(token, context) {
    const site = parseEightfoldToken(token);
    const domain = encodeURIComponent(site.domain);
    return site.pcsx
      ? ((
          await getJson<PcsxList>(
            `https://${site.host}/api/pcsx/search?domain=${domain}&query=&location=&start=0&num=1`,
            context,
          )
        ).data?.count ?? 0)
      : ((
          await getJson<ApplyList>(
            `https://${site.host}/api/apply/v2/jobs?domain=${domain}&start=0&num=1`,
            context,
          )
        ).count ?? 0);
  },
  async listJobs(token, context) {
    const site = parseEightfoldToken(token);
    const domain = encodeURIComponent(site.domain);
    const jobs: NormalizedJob[] = [];
    let total = 0;
    for (let start = 0; start < MAX_POSITIONS; start += PAGE_SIZE) {
      let page: NormalizedJob[];
      if (site.pcsx) {
        const url = `https://${site.host}/api/pcsx/search?domain=${domain}&query=&location=&start=${start}&num=${PAGE_SIZE}&sort_by=timestamp`;
        const data = (await getJson<PcsxList>(url, context)).data;
        total = data?.count ?? total;
        page = (data?.positions ?? []).map((position) => mapPcsxPosition(site, position));
      } else {
        const url = `https://${site.host}/api/apply/v2/jobs?domain=${domain}&start=${start}&num=${PAGE_SIZE}`;
        const data = await getJson<ApplyList>(url, context);
        total = data.count ?? total;
        page = (data.positions ?? []).map((position) => mapApplyPosition(site, position));
      }
      jobs.push(...page);
      if (page.length < PAGE_SIZE || jobs.length >= total) break;
    }
    // Pages can shift while a big board is read; keep each position once.
    const unique = [...new Map(jobs.map((job) => [job.externalId, job])).values()];
    return { jobs: unique, complete: unique.length >= total };
  },
  async hydrate(token, job, context) {
    const site = parseEightfoldToken(token);
    const domain = encodeURIComponent(site.domain);
    if (site.pcsx) {
      const url = `https://${site.host}/api/pcsx/position_details?position_id=${encodeURIComponent(job.externalId)}&domain=${domain}&hl=en`;
      const data = (await getJson<PcsxDetail>(url, context)).data;
      const hydrated = withDescription(job, data?.jobDescription ?? "", data?.publicUrl);
      return { ...hydrated, employmentType: data?.efcustomTextEmploymentType?.[0] ?? "" };
    }
    const url = `https://${site.host}/api/apply/v2/jobs/${encodeURIComponent(job.externalId)}?domain=${domain}`;
    const detail = await getJson<ApplyDetail>(url, context);
    return withDescription(job, detail.job_description ?? "", detail.canonicalPositionUrl);
  },
};
