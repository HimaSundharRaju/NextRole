import { inferWorkplaceType, parseSalaryFromText } from "../normalize";
import { htmlToText } from "../sanitize";
import { getJson } from "./http";
import type { BoardConnector, NormalizedJob, NormalizedSalary } from "./types";

// Bullhorn's public jobs API (bullhorn.github.io/Public-API), which staffing firms' career
// portals read. Staffing firms post their clients' roles here, many of them contracts (W-2,
// C2C), with the pay rate, required years and a sponsorship flag.

interface BullhornJob {
  id: number;
  title: string;
  publicDescription?: string | null;
  address?: { city?: string | null; state?: string | null; countryID?: number | null } | null;
  employmentType?: string | null;
  payRate?: number | null;
  salary?: number | null;
  salaryUnit?: string | null;
  willSponsor?: boolean | null;
  yearsRequired?: number | null;
  dateAdded?: number | null;
  /** A field many firms add to their public list: "On-Site", "Remote" or "Hybrid". */
  onSite?: string | null;
  publishedCategory?: { name?: string | null } | null;
}

interface BullhornSearch {
  total?: number;
  data?: BullhornJob[];
}

interface BullhornBoard {
  cluster: string;
  corpToken: string;
  /** The firm's career portal (host and path), where a job's page is #/jobs/<id>. */
  portal: string;
}

const PAGE_SIZE = 200;
const MAX_JOBS = 5000;
/** Bullhorn's country id for the United States. */
const UNITED_STATES = 1;

/** Tokens are `cluster|corpToken|portal`, e.g. `30|3vcpe1|www.ceiamerica.com/jobs`. */
export function parseBullhornToken(token: string): BullhornBoard {
  const [cluster = "", corpToken = "", portal = ""] = token.split("|");
  if (!/^\d+$/.test(cluster) || !corpToken || !portal) {
    throw new Error(`A Bullhorn board token is cluster|corpToken|portal, got "${token}"`);
  }
  return { cluster, corpToken, portal: portal.replace(/\/+$/, "") };
}

const search = (board: BullhornBoard, start: number, count: number) =>
  `https://public-rest${board.cluster}.bullhornstaffing.com/rest-services/${encodeURIComponent(board.corpToken)}/search/JobOrder?query=(isOpen:1)&fields=*&count=${count}&start=${start}&sort=-dateLastPublished`;

/** The pay the posting states: the contractor's rate, or else the salary, in its unit. */
function payOf(job: BullhornJob, currency: string | null): NormalizedSalary | null {
  const amount = job.payRate && job.payRate > 0 ? job.payRate : (job.salary ?? 0);
  if (!(amount > 0)) return null;
  const unit = (job.salaryUnit ?? "").toLowerCase();
  const period = unit.includes("hour")
    ? "hour"
    : unit.includes("month")
      ? "month"
      : unit.includes("year") || unit.includes("annual") || amount >= 20_000
        ? "year"
        : amount < 500
          ? "hour"
          : null;
  return period ? { min: amount, max: amount, currency, period } : null;
}

function workplaceOf(job: BullhornJob, location: string, text: string) {
  const stated = job.onSite ?? "";
  if (/remote/i.test(stated)) return "remote" as const;
  if (/hybrid/i.test(stated)) return "hybrid" as const;
  if (/on-?site/i.test(stated)) return "onsite" as const;
  return inferWorkplaceType([location, text.slice(0, 600)]);
}

export function mapBullhornJob(board: BullhornBoard, job: BullhornJob): NormalizedJob {
  const html = job.publicDescription ?? "";
  const text = htmlToText(html);
  const address = job.address ?? {};
  const location = [address.city, address.state].filter(Boolean).join(", ");
  const us = address.countryID === UNITED_STATES;
  return {
    externalId: String(job.id),
    title: job.title.trim(),
    department: job.publishedCategory?.name ?? "",
    location,
    workplaceType: workplaceOf(job, location, text),
    // "VMS" roles come through a client's vendor system: contracts under another name.
    employmentType: job.employmentType === "VMS" ? "Contract" : (job.employmentType ?? ""),
    descriptionHtml: html,
    applyUrl: `https://${board.portal}/#/jobs/${job.id}`,
    postedAt: job.dateAdded ? new Date(job.dateAdded) : null,
    // A range written in the description says more than the single figure in the record.
    salary: parseSalaryFromText(text) ?? payOf(job, us ? "USD" : null),
    placeHints: [{ country: us ? "US" : undefined, region: address.state, city: address.city }],
    yearsMin: job.yearsRequired && job.yearsRequired > 0 ? job.yearsRequired : null,
    // Unticked is the default, not a statement, so only a yes counts.
    ...(job.willSponsor === true ? { sponsorship: "yes" as const } : {}),
  };
}

export const bullhorn: BoardConnector = {
  provider: "bullhorn",
  boardUrl: (token) => `https://${parseBullhornToken(token).portal}/`,
  async countJobs(token, context) {
    return (
      (await getJson<BullhornSearch>(search(parseBullhornToken(token), 0, 1), context)).total ?? 0
    );
  },
  async listJobs(token, context) {
    const board = parseBullhornToken(token);
    const jobs: NormalizedJob[] = [];
    let total = 0;
    for (let start = 0; start < MAX_JOBS; start += PAGE_SIZE) {
      const page = await getJson<BullhornSearch>(search(board, start, PAGE_SIZE), context);
      total = page.total ?? total;
      const batch = page.data ?? [];
      jobs.push(...batch.map((job) => mapBullhornJob(board, job)));
      if (batch.length < PAGE_SIZE || jobs.length >= total) break;
    }
    return { jobs, complete: jobs.length >= total };
  },
};
