import type { EmploymentType, Seniority } from "@gettargetrole/db/schema";

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
