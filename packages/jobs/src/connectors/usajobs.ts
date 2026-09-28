import { inferWorkplaceType } from "../normalize";
import { textToHtml } from "./feed-text";
import { getJson } from "./http";
import type { BoardConnector, ConnectorContext, NormalizedJob, NormalizedSalary } from "./types";

// USAJOBS, the US federal government's job board (developer.usajobs.gov/api-reference): a free
// API that takes a key and the email it was registered with. Most federal jobs require U.S.
// citizenship, which the posts say and the visa parser reads.

interface UsajobsDescriptor {
  PositionID?: string;
  PositionTitle: string;
  PositionURI?: string;
  ApplyURI?: string[];
  PositionLocationDisplay?: string;
  PositionLocation?: Array<{
    LocationName?: string;
    CountryCode?: string;
    CountrySubDivisionCode?: string;
    CityName?: string;
  }>;
  OrganizationName?: string;
  DepartmentName?: string;
  PositionSchedule?: Array<{ Name?: string }>;
  PositionOfferingType?: Array<{ Name?: string }>;
  QualificationSummary?: string;
  PositionRemuneration?: Array<{
    MinimumRange?: string | number;
    MaximumRange?: string | number;
    RateIntervalCode?: string;
  }>;
  PublicationStartDate?: string;
  ApplicationCloseDate?: string;
  UserArea?: {
    Details?: {
      JobSummary?: string;
      MajorDuties?: string[] | string;
      Education?: string;
      Requirements?: string;
      TeleworkEligible?: boolean;
      RemoteIndicator?: boolean;
    };
  };
}

interface UsajobsSearch {
  SearchResult?: {
    SearchResultCountAll?: number;
    SearchResultItems?: Array<{
      MatchedObjectId?: string;
      MatchedObjectDescriptor: UsajobsDescriptor;
    }>;
  };
}

const PAGE_SIZE = 500;
const MAX_JOBS = 5000;

function credentials(): Record<string, string> {
  const key = process.env.USAJOBS_API_KEY;
  const email = process.env.USAJOBS_EMAIL;
  if (!key || !email) throw new Error("USAJOBS_API_KEY and USAJOBS_EMAIL aren't set");
  // The API asks for the registered email as the User-Agent.
  return { "user-agent": email, "authorization-key": key };
}

/** Tokens are occupational series codes, semicolon-separated: 2210 is IT management. */
const searchUrl = (token: string, page: number, size: number) =>
  `https://data.usajobs.gov/api/search?JobCategoryCode=${encodeURIComponent(token)}&ResultsPerPage=${size}&Page=${page}`;

async function search(token: string, page: number, size: number, context: ConnectorContext) {
  return getJson<UsajobsSearch>(searchUrl(token, page, size), context, { headers: credentials() });
}

function payOf(job: UsajobsDescriptor): NormalizedSalary | null {
  const pay = job.PositionRemuneration?.[0];
  const min = Number(pay?.MinimumRange);
  const max = Number(pay?.MaximumRange);
  if (!(min > 0)) return null;
  const code = pay?.RateIntervalCode ?? "";
  const period = /hour|^PH$/i.test(code)
    ? "hour"
    : /month|^PM$/i.test(code)
      ? "month"
      : /year|annum|^PA$/i.test(code)
        ? "year"
        : null;
  return period ? { min, max: max >= min ? max : min, currency: "USD", period } : null;
}

export function mapUsajobs(id: string, job: UsajobsDescriptor): NormalizedJob {
  const details = job.UserArea?.Details ?? {};
  const duties = Array.isArray(details.MajorDuties)
    ? details.MajorDuties.join("\n\n")
    : (details.MajorDuties ?? "");
  const sections: Array<[string, string | undefined]> = [
    ["Summary", details.JobSummary],
    ["Duties", duties],
    ["Qualifications", job.QualificationSummary],
    ["Requirements", details.Requirements],
    ["Education", details.Education],
  ];
  const html = sections
    .filter(([, text]) => text?.trim())
    .map(([heading, text]) => `<h3>${heading}</h3>${textToHtml(text!)}`)
    .join("");
  const places = (job.PositionLocation ?? []).flatMap((place) =>
    place.LocationName ? [place.LocationName] : [],
  );
  // A post open in many places says "Multiple Locations"; the first few say more.
  const location =
    places.length > 1
      ? places.slice(0, 3).join("; ") + (places.length > 3 ? `; and ${places.length - 3} more` : "")
      : (job.PositionLocationDisplay ?? places[0] ?? "");
  return {
    externalId: id,
    title: job.PositionTitle.trim(),
    employer: job.OrganizationName || job.DepartmentName || "U.S. federal government",
    department: job.DepartmentName ?? "",
    location,
    workplaceType: details.RemoteIndicator
      ? "remote"
      : details.TeleworkEligible
        ? "hybrid"
        : inferWorkplaceType([location]),
    // "Full-time, Permanent", "Part-time, Temporary".
    employmentType: [job.PositionSchedule?.[0]?.Name, job.PositionOfferingType?.[0]?.Name]
      .filter(Boolean)
      .join(", "),
    descriptionHtml: html,
    applyUrl: job.ApplyURI?.[0] ?? job.PositionURI ?? "https://www.usajobs.gov/",
    postedAt: job.PublicationStartDate ? new Date(job.PublicationStartDate) : null,
    expiresAt: job.ApplicationCloseDate ? new Date(job.ApplicationCloseDate) : null,
    salary: payOf(job),
    placeHints: (job.PositionLocation ?? []).map((place) => ({
      country: place.CountryCode,
      region: place.CountrySubDivisionCode,
      city: place.CityName?.split(",")[0],
    })),
  };
}

export const usajobs: BoardConnector = {
  provider: "usajobs",
  boardUrl: () => "https://www.usajobs.gov/",
  async countJobs(token, context) {
    return (await search(token, 1, 1, context)).SearchResult?.SearchResultCountAll ?? 0;
  },
  async listJobs(token, context) {
    const jobs: NormalizedJob[] = [];
    let total = 0;
    for (let page = 1; jobs.length < MAX_JOBS; page++) {
      const result = (await search(token, page, PAGE_SIZE, context)).SearchResult;
      total = result?.SearchResultCountAll ?? total;
      const items = result?.SearchResultItems ?? [];
      jobs.push(
        ...items.map((item) =>
          mapUsajobs(
            item.MatchedObjectId ?? item.MatchedObjectDescriptor.PositionID ?? "",
            item.MatchedObjectDescriptor,
          ),
        ),
      );
      if (items.length < PAGE_SIZE || jobs.length >= total) break;
    }
    return { jobs: jobs.filter((job) => job.externalId), complete: jobs.length >= total };
  },
};
