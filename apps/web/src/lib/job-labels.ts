import type { EmploymentType } from "@gettargetrole/db/schema";

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
