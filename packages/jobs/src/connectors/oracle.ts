import { inferWorkplaceType, parseSalaryFromText } from "../normalize";
import { htmlToText } from "../sanitize";
import { getJson } from "./http";
import type { BoardConnector, NormalizedJob } from "./types";

// Oracle Recruiting Cloud's candidate-experience API, which Oracle-hosted careers sites
// (JPMorgan Chase, among others) read from: requisitions page by page, then one per detail call.

interface OracleLocation {
  Name?: string;
  CountryCode?: string;
}

interface OracleRequisition {
  Id: string;
  Title: string;
  PostedDate?: string | null;
  PrimaryLocation?: string | null;
  PrimaryLocationCountry?: string | null;
  WorkplaceType?: string | null;
  JobFamily?: string | null;
  secondaryLocations?: OracleLocation[];
}

interface OracleList {
  items?: Array<{ TotalJobsCount?: number; requisitionList?: OracleRequisition[] }>;
}

interface OracleDetail {
  items?: Array<{
    ExternalDescriptionStr?: string | null;
    ExternalResponsibilitiesStr?: string | null;
    ExternalQualificationsStr?: string | null;
    CorporateDescriptionStr?: string | null;
    JobSchedule?: string | null;
    ExternalPostedStartDate?: string | null;
    WorkplaceType?: string | null;
  }>;
}

interface OracleSite {
  host: string;
  siteNumber: string;
}

const PAGE_SIZE = 200;
const MAX_REQUISITIONS = 20_000;

/** Tokens are `host|siteNumber`, e.g. `jpmc.fa.oraclecloud.com|CX_1001`. */
export function parseOracleToken(token: string): OracleSite {
  const [host = "", siteNumber = ""] = token.split("|");
  if (!host || !siteNumber) {
    throw new Error(`An Oracle board token is host|siteNumber, got "${token}"`);
  }
  return { host, siteNumber };
}

const api = (site: OracleSite) => `https://${site.host}/hcmRestApi/resources/latest`;

const jobUrl = (site: OracleSite, id: string) =>
  `https://${site.host}/hcmUI/CandidateExperience/en/sites/${site.siteNumber}/job/${encodeURIComponent(id)}`;

export function mapOracleRequisition(site: OracleSite, req: OracleRequisition): NormalizedJob {
  const others = (req.secondaryLocations ?? []).map((location) => location.Name ?? "");
  const locations = [req.PrimaryLocation ?? "", ...others].filter(Boolean);
  return {
    externalId: req.Id,
    title: req.Title.trim(),
    department: req.JobFamily ?? "",
    location: locations.join(" / "),
    workplaceType: inferWorkplaceType([req.WorkplaceType, ...locations]),
    employmentType: "",
    descriptionHtml: "",
    applyUrl: jobUrl(site, req.Id),
    postedAt: req.PostedDate ? new Date(req.PostedDate) : null,
    salary: null,
    placeHints: [
      { country: req.PrimaryLocationCountry },
      ...(req.secondaryLocations ?? []).map((location) => ({ country: location.CountryCode })),
    ],
    needsHydration: true,
  };
}

export const oracle: BoardConnector = {
  provider: "oracle",
  boardUrl: (token) => {
    const site = parseOracleToken(token);
    return `https://${site.host}/hcmUI/CandidateExperience/en/sites/${site.siteNumber}/jobs`;
  },
  hydrationsPerSync: 250,
  async countJobs(token, context) {
    const site = parseOracleToken(token);
    const url = `${api(site)}/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=${encodeURIComponent(site.siteNumber)},limit=1,offset=0`;
    return (await getJson<OracleList>(url, context)).items?.[0]?.TotalJobsCount ?? 0;
  },
  async listJobs(token, context) {
    const site = parseOracleToken(token);
    const jobs: NormalizedJob[] = [];
    let total = 0;
    for (let offset = 0; offset < MAX_REQUISITIONS; offset += PAGE_SIZE) {
      // The finder's own separators (; and ,) must reach the API as they are.
      const url = `${api(site)}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${encodeURIComponent(site.siteNumber)},limit=${PAGE_SIZE},offset=${offset},sortBy=POSTING_DATES_DESC`;
      const [result] = (await getJson<OracleList>(url, context)).items ?? [];
      const page = result?.requisitionList ?? [];
      total = result?.TotalJobsCount ?? total;
      jobs.push(...page.map((req) => mapOracleRequisition(site, req)));
      if (page.length < PAGE_SIZE || jobs.length >= total) break;
    }
    return { jobs, complete: jobs.length >= total };
  },
  async hydrate(token, job, context) {
    const site = parseOracleToken(token);
    const url = `${api(site)}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${encodeURIComponent(job.externalId)}%22,siteNumber=${encodeURIComponent(site.siteNumber)}`;
    const [detail] = (await getJson<OracleDetail>(url, context)).items ?? [];
    if (!detail) return job;
    const html = [
      detail.ExternalDescriptionStr,
      detail.ExternalResponsibilitiesStr,
      detail.ExternalQualificationsStr,
    ]
      .filter((part): part is string => Boolean(part?.trim()))
      .join("");
    const text = htmlToText(html);
    return {
      ...job,
      workplaceType: inferWorkplaceType([detail.WorkplaceType, job.location, text.slice(0, 600)]),
      employmentType: detail.JobSchedule ?? job.employmentType,
      descriptionHtml: html,
      postedAt: detail.ExternalPostedStartDate
        ? new Date(detail.ExternalPostedStartDate)
        : job.postedAt,
      salary: parseSalaryFromText(text),
      needsHydration: false,
    };
  },
};
