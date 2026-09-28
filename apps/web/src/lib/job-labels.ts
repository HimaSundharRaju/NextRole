import type {
  EmploymentType,
  GhostReason,
  JobReportReason,
  Seniority,
} from "@gettargetrole/db/schema";

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
  w2: "W-2",
  c2c: "C2C",
  "1099": "1099",
};

export const EMPLOYMENT_TYPE_OPTIONS = Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[];

/** Job-board visa filter: everything, hide posts that rule out sponsorship, or only sponsors. */
export const VISA_FILTERS = ["any", "open", "offers"] as const;
export type VisaFilter = (typeof VISA_FILTERS)[number];

export const VISA_FILTER_LABEL: Record<VisaFilter, string> = {
  any: "Any visa status",
  open: "Hide 'no sponsorship' posts",
  offers: "Says it sponsors visas",
};

export const SALARY_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "INR", "AUD", "SGD"] as const;

export const SENIORITY_LABEL: Record<Seniority, string> = {
  intern: "Internship level",
  entry: "Entry level",
  mid: "Mid level",
  senior: "Senior level",
  staff: "Staff level",
  principal: "Principal level",
  manager: "Manager",
  director: "Director",
  executive: "Executive",
};

export const EDUCATION_LABEL: Record<string, string> = {
  none: "No degree required",
  bachelors: "Bachelor's degree",
  masters: "Master's degree",
  phd: "PhD",
};

/** What job enrichment stored for a post, as far as the job page shows it. */
export interface JobEnrichmentView {
  summary?: string;
  education?: string | null;
  quotes?: Partial<Record<string, string>>;
}

export interface FeedCredit {
  /** The credit shown with each of the feed's jobs. */
  label: string;
  site: string;
  url: string;
  /** The feed shares only the start of each description. */
  snippet: boolean;
  /** The feed is the job's official listing, so its listing shows the job is open. */
  official: boolean;
}

/** How jobs from feeds are credited; Adzuna's terms ask for "Jobs by Adzuna" with each one. */
export const FEED_CREDIT: Partial<Record<string, FeedCredit>> = {
  usajobs: {
    label: "via USAJOBS",
    site: "USAJOBS",
    url: "https://www.usajobs.gov/",
    snippet: false,
    official: true,
  },
  adzuna: {
    label: "Jobs by Adzuna",
    site: "Adzuna",
    url: "https://www.adzuna.com/",
    snippet: true,
    official: false,
  },
};

export const JOB_REPORT_REASON_LABEL: Record<JobReportReason, string> = {
  closed: "It's filled or no longer open",
  no_reply: "I applied and never heard back",
  not_real: "It looks fake or misleading",
  other: "Something else",
};

const DAY_MS = 86_400_000;

/** The signs of a ghost job a post shows, in plain words. */
export function ghostWarnings(
  job: {
    ghostReasons: GhostReason[];
    repostCount: number;
    postedAt: Date | null;
    firstSeenAt: Date;
  },
  now = Date.now(),
): string[] {
  const months = Math.floor((now - (job.postedAt ?? job.firstSeenAt).getTime()) / (30 * DAY_MS));
  return job.ghostReasons.flatMap((reason) => {
    switch (reason) {
      case "open_60d":
      case "open_120d":
        return [`Open ${months}+ months`];
      case "reposted":
        return job.repostCount > 0 ? [`Reposted ${job.repostCount}×`] : [];
      case "evergreen":
        return ["Talent pool, not one opening"];
      case "reported":
        return ["Reported by job seekers"];
    }
  });
}

/** A job its board listed this recently counts as checked and still open. */
export const VERIFIED_OPEN_MS = 2 * DAY_MS;
