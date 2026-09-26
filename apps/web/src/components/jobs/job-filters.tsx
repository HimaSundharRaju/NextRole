"use client";

import { countryLabel, regionLabel } from "@gettargetrole/jobs/locations";
import { Search } from "lucide-react";
import Form from "next/form";
import type { ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import {
  EMPLOYMENT_TYPE_LABEL,
  EMPLOYMENT_TYPE_OPTIONS,
  SALARY_CURRENCIES,
  VISA_FILTER_LABEL,
  VISA_FILTERS,
  type VisaFilter,
} from "@/lib/job-labels";

interface Facet {
  code: string;
  count: number;
}

export function JobFilters({
  filters,
  visa,
  companies,
  countries,
  regions,
}: {
  filters: {
    q?: string;
    workplace?: string;
    posted?: string;
    sort?: string;
    minMatch?: string;
    company?: string;
    country?: string;
    region?: string;
    type?: string[];
    salaryMin?: number;
    salaryMax?: number;
    currency?: string;
  };
  /** The visa filter in effect, including the default from the profile. */
  visa: VisaFilter;
  companies: Array<{ slug: string; name: string; openJobCount: number }>;
  countries: Facet[];
  regions: Facet[];
}) {
  const submitOnChange = (event: ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    event.currentTarget.form?.requestSubmit();
  const types = new Set(filters.type ?? []);

  return (
    <Form
      action="/jobs"
      className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm"
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Search titles, skills or keywords, e.g. backend kubernetes"
            className="pl-9"
            aria-label="Search jobs"
          />
        </div>
        <Button type="submit" className="shrink-0">
          Search
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Select
          name="workplace"
          defaultValue={filters.workplace ?? "any"}
          onChange={submitOnChange}
          aria-label="Work style"
        >
          <option value="any">Any work style</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
          <option value="onsite">On-site</option>
        </Select>
        <Select
          name="posted"
          defaultValue={filters.posted ?? "any"}
          onChange={submitOnChange}
          aria-label="Posted within"
        >
          <option value="any">Any time</option>
          <option value="24h">Last 24 hours</option>
          <option value="3d">Last 3 days</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </Select>
        <Select
          name="company"
          defaultValue={filters.company ?? ""}
          onChange={submitOnChange}
          aria-label="Company"
        >
          <option value="">All companies</option>
          {companies.map((company) => (
            <option key={company.slug} value={company.slug}>
              {company.name} ({company.openJobCount})
            </option>
          ))}
        </Select>
        <Select
          name="sort"
          defaultValue={filters.sort ?? "match"}
          onChange={submitOnChange}
          aria-label="Sort by"
        >
          <option value="match">Best match</option>
          <option value="newest">Newest</option>
        </Select>
        <Select
          name="minMatch"
          defaultValue={filters.minMatch ?? ""}
          onChange={submitOnChange}
          aria-label="Minimum match"
        >
          <option value="">Any match</option>
          <option value="60">60%+ match</option>
          <option value="70">70%+ match</option>
          <option value="80">80%+ match</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Select
          name="country"
          defaultValue={filters.country ?? ""}
          onChange={submitOnChange}
          aria-label="Country"
        >
          <option value="">Any country</option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {countryLabel(country.code)} ({country.count})
            </option>
          ))}
        </Select>
        <Select
          name="region"
          defaultValue={filters.region ?? ""}
          onChange={submitOnChange}
          disabled={!filters.country || regions.length === 0}
          aria-label="State or province"
        >
          <option value="">{filters.country ? "Any state" : "Pick a country first"}</option>
          {regions.map((region) => (
            <option key={region.code} value={region.code}>
              {regionLabel(region.code)} ({region.count})
            </option>
          ))}
        </Select>
        <Select name="visa" defaultValue={visa} onChange={submitOnChange} aria-label="Visa">
          {VISA_FILTERS.map((option) => (
            <option key={option} value={option}>
              {VISA_FILTER_LABEL[option]}
            </option>
          ))}
        </Select>
        <div className="flex gap-1">
          <Input
            name="salaryMin"
            type="number"
            min={0}
            step={1000}
            defaultValue={filters.salaryMin ?? ""}
            placeholder="Min / year"
            aria-label="Minimum yearly pay"
          />
          <Input
            name="salaryMax"
            type="number"
            min={0}
            step={1000}
            defaultValue={filters.salaryMax ?? ""}
            placeholder="Max / year"
            aria-label="Maximum yearly pay"
          />
          <Select
            name="currency"
            defaultValue={filters.currency ?? "USD"}
            onChange={submitOnChange}
            aria-label="Currency"
            className="w-20 shrink-0"
          >
            {SALARY_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <fieldset className="flex flex-wrap items-center gap-1.5">
        <legend className="sr-only">Employment type</legend>
        {EMPLOYMENT_TYPE_OPTIONS.map((type) => (
          <label
            key={type}
            className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary"
          >
            <input
              type="checkbox"
              name="type"
              value={type}
              defaultChecked={types.has(type)}
              onChange={submitOnChange}
              className="sr-only"
            />
            {EMPLOYMENT_TYPE_LABEL[type]}
          </label>
        ))}
        <span className="text-xs text-muted-foreground">
          W-2, C2C and 1099 show up when a post says so.
        </span>
      </fieldset>
    </Form>
  );
}
