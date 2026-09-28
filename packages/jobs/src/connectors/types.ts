import type { AtsProvider, WorkplaceType } from "@gettargetrole/db/schema";

export interface NormalizedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: "year" | "month" | "hour" | null;
}

/** A job posting mapped from any ATS into one shape. `descriptionHtml` is still unsanitized. */
export interface NormalizedJob {
  externalId: string;
  title: string;
  department: string;
  location: string;
  workplaceType: WorkplaceType;
  employmentType: string;
  descriptionHtml: string;
  applyUrl: string;
  postedAt: Date | null;
  salary: NormalizedSalary | null;
  /** True when the listing endpoint omits the description and `hydrate` must be called. */
  needsHydration?: boolean;
}

export type Fetcher = typeof fetch;

export interface ConnectorContext {
  fetch: Fetcher;
  signal?: AbortSignal;
}

export interface BoardConnector {
  provider: AtsProvider;
  /** Public careers page for a board, used for links in the admin console. */
  boardUrl(boardToken: string): string;
  listJobs(boardToken: string, context: ConnectorContext): Promise<NormalizedJob[]>;
  /** Fetches full details for postings whose listing lacks a description. */
  hydrate?(
    boardToken: string,
    job: NormalizedJob,
    context: ConnectorContext,
  ): Promise<NormalizedJob>;
}
