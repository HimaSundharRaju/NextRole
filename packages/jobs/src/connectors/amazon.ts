import { inferWorkplaceType, parseSalaryFromText } from "../normalize";
import { htmlToText } from "../sanitize";
import { getJson } from "./http";
import type { BoardConnector, ConnectorContext, NormalizedJob } from "./types";

// amazon.jobs search JSON: postings come with their full description, 100 per page. A search
// stops at 10,000 results, so the board is read one country at a time, and a country above the
// cap (the US) one business category at a time.

interface AmazonJob {
  id_icims: string;
  title: string;
  description?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
  location?: string;
  normalized_location?: string;
  locations?: string[];
  city?: string;
  state?: string;
  country_code?: string;
  posted_date?: string;
  job_path: string;
  job_category?: string;
  job_schedule_type?: string;
}

type FacetCounts = Array<Record<string, number>>;

interface AmazonSearch {
  hits?: number;
  jobs?: AmazonJob[];
  facets?: {
    normalized_country_code_facet?: FacetCounts;
    business_category_facet?: FacetCounts;
  };
}

const BASE = "https://www.amazon.jobs/en/search.json";
const PAGE_SIZE = 100;
export const AMAZON_SEARCH_CAP = 10_000;

/** The board token lists ISO 3166 alpha-3 countries ("USA,IND"), or is "all". */
function countriesOf(token: string): string[] | null {
  return token === "all"
    ? null
    : token
        .split(",")
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean);
}

const entries = (facet: FacetCounts | undefined) =>
  (facet ?? []).flatMap((entry) => Object.entries(entry));

/** One entry of `locations`, a JSON string per location. */
function placeOf(raw: string): { country?: string; region?: string; city?: string } {
  try {
    const place = JSON.parse(raw) as {
      countryIso2a?: string;
      normalizedStateName?: string;
      city?: string;
    };
    return { country: place.countryIso2a, region: place.normalizedStateName, city: place.city };
  } catch {
    return {};
  }
}

export function mapAmazonJob(job: AmazonJob): NormalizedJob {
  const sections = [
    job.description ?? "",
    job.basic_qualifications
      ? `<h3>Basic qualifications</h3><p>${job.basic_qualifications}</p>`
      : "",
    job.preferred_qualifications
      ? `<h3>Preferred qualifications</h3><p>${job.preferred_qualifications}</p>`
      : "",
  ];
  const html = sections.join("");
  const text = htmlToText(html);
  const location = job.normalized_location || job.location || "";
  const places = (job.locations ?? []).map(placeOf).filter((place) => place.country);
  const posted = job.posted_date ? new Date(job.posted_date) : null;
  return {
    externalId: job.id_icims,
    title: job.title.trim(),
    department: job.job_category ?? "",
    location,
    workplaceType: inferWorkplaceType([location, text.slice(0, 600)]),
    employmentType: job.job_schedule_type ?? "",
    descriptionHtml: html,
    applyUrl: `https://www.amazon.jobs${job.job_path}`,
    postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    salary: parseSalaryFromText(text),
    placeHints: places.length > 0 ? places : [{ country: job.country_code, city: job.city }],
  };
}

async function search(context: ConnectorContext, query: string): Promise<AmazonSearch> {
  return getJson<AmazonSearch>(`${BASE}?${query}`, context);
}

/** Every posting of one filtered search, up to the cap. */
async function readAll(
  context: ConnectorContext,
  filter: string,
  count: number,
): Promise<AmazonJob[]> {
  const jobs: AmazonJob[] = [];
  for (let offset = 0; offset < Math.min(count, AMAZON_SEARCH_CAP); offset += PAGE_SIZE) {
    const page = (
      await search(context, `${filter}&offset=${offset}&result_limit=${PAGE_SIZE}&sort=recent`)
    ).jobs;
    jobs.push(...(page ?? []));
    if (!page || page.length < PAGE_SIZE) break;
  }
  return jobs;
}

export const amazon: BoardConnector = {
  provider: "amazon",
  boardUrl: () => "https://www.amazon.jobs/en/search",
  async countJobs(token, context) {
    const overview = await search(
      context,
      "offset=0&result_limit=1&facets[]=normalized_country_code",
    );
    const wanted = countriesOf(token);
    return entries(overview.facets?.normalized_country_code_facet)
      .filter(([code]) => !wanted || wanted.includes(code))
      .reduce((total, [, count]) => total + count, 0);
  },
  async listJobs(token, context) {
    const facets =
      "offset=0&result_limit=1&facets[]=normalized_country_code&facets[]=business_category";
    const overview = await search(context, facets);
    const wanted = countriesOf(token);
    const countries = entries(overview.facets?.normalized_country_code_facet).filter(
      ([code]) => !wanted || wanted.includes(code),
    );
    const expected = countries.reduce((total, [, count]) => total + count, 0);

    const byId = new Map<string, AmazonJob>();
    let capped = false;
    for (const [country, count] of countries) {
      const filter = `normalized_country_code[]=${encodeURIComponent(country)}`;
      if (count <= AMAZON_SEARCH_CAP) {
        for (const job of await readAll(context, filter, count)) byId.set(job.id_icims, job);
        continue;
      }
      const inCountry = await search(context, `${filter}&${facets}`);
      for (const [category, categoryCount] of entries(inCountry.facets?.business_category_facet)) {
        capped ||= categoryCount > AMAZON_SEARCH_CAP;
        const both = `${filter}&business_category[]=${encodeURIComponent(category)}`;
        for (const job of await readAll(context, both, categoryCount)) byId.set(job.id_icims, job);
      }
    }
    const jobs = [...byId.values()].map(mapAmazonJob);
    // Facet counts lag the listings slightly, so a near-total read counts as complete.
    return { jobs, complete: !capped && expected > 0 && jobs.length >= expected * 0.98 };
  },
};
