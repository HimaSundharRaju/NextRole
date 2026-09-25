"use client";

import { Search } from "lucide-react";
import Form from "next/form";
import type { ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";

export function JobFilters({
  filters,
  companies,
}: {
  filters: { q?: string; workplace?: string; posted?: string; sort?: string; company?: string };
  companies: Array<{ slug: string; name: string; openJobCount: number }>;
}) {
  const submitOnChange = (event: ChangeEvent<HTMLSelectElement>) =>
    event.currentTarget.form?.requestSubmit();

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
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
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
      </div>
    </Form>
  );
}
