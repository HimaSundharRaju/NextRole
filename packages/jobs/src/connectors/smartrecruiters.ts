import { inferWorkplaceType, parseSalaryFromText } from "../normalize";
import { htmlToText } from "../sanitize";
import { getJson } from "./http";
import type { BoardConnector, NormalizedJob } from "./types";

// https://developers.smartrecruiters.com/docs/posting-api
interface SmartRecruitersPosting {
  id: string;
  name: string;
  releasedDate?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
    hybrid?: boolean;
    fullLocation?: string;
  };
  department?: { label?: string };
  typeOfEmployment?: { label?: string };
}

interface SmartRecruitersList {
  totalFound: number;
  offset: number;
  limit: number;
  content: SmartRecruitersPosting[];
}

interface SmartRecruitersDetail extends SmartRecruitersPosting {
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string } | undefined>;
  };
}

const PAGE_SIZE = 100;
const MAX_POSTINGS = 1000;

function postingUrl(company: string, id: string): string {
  return `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${encodeURIComponent(id)}`;
}

function locationText(posting: SmartRecruitersPosting): string {
  const loc = posting.location;
  if (!loc) return "";
  return loc.fullLocation ?? [loc.city, loc.region, loc.country].filter(Boolean).join(", ");
}

export function mapSmartRecruitersPosting(
  company: string,
  posting: SmartRecruitersPosting,
): NormalizedJob {
  const location = locationText(posting);
  return {
    externalId: posting.id,
    title: posting.name.trim(),
    department: posting.department?.label ?? "",
    location,
    workplaceType: posting.location?.remote
      ? "remote"
      : posting.location?.hybrid
        ? "hybrid"
        : inferWorkplaceType([location]),
    employmentType: posting.typeOfEmployment?.label ?? "",
    descriptionHtml: "",
    applyUrl: postingUrl(company, posting.id),
    postedAt: posting.releasedDate ? new Date(posting.releasedDate) : null,
    salary: null,
    needsHydration: true,
  };
}

export const smartrecruiters: BoardConnector = {
  provider: "smartrecruiters",
  boardUrl: (token) => `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}`,
  async listJobs(token, context) {
    const results: NormalizedJob[] = [];
    for (let offset = 0; offset < MAX_POSTINGS; offset += PAGE_SIZE) {
      const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=${PAGE_SIZE}&offset=${offset}`;
      const page = await getJson<SmartRecruitersList>(url, context);
      results.push(...page.content.map((posting) => mapSmartRecruitersPosting(token, posting)));
      if (page.content.length < PAGE_SIZE || results.length >= page.totalFound) break;
    }
    return results;
  },
  async hydrate(token, job, context) {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings/${encodeURIComponent(job.externalId)}`;
    const detail = await getJson<SmartRecruitersDetail>(url, context);
    const sections = detail.jobAd?.sections ?? {};
    const html = ["jobDescription", "qualifications", "additionalInformation"]
      .map((key) => sections[key])
      .filter((section): section is { title?: string; text?: string } => Boolean(section?.text))
      .map((section) => `${section.title ? `<h3>${section.title}</h3>` : ""}${section.text}`)
      .join("");
    const text = htmlToText(html);
    return {
      ...job,
      descriptionHtml: html,
      applyUrl: detail.applyUrl ?? detail.postingUrl ?? job.applyUrl,
      workplaceType:
        job.workplaceType === "unknown"
          ? inferWorkplaceType([job.location, text.slice(0, 600)])
          : job.workplaceType,
      salary: parseSalaryFromText(text),
      needsHydration: false,
    };
  },
};
