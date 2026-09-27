import type { AtsProvider, WorkplaceType } from "@gettargetrole/db/schema";
import type { PlaceHint } from "../locations";

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
  /** Structured country/state/city from the board, which beats parsing `location`. */
  placeHints?: PlaceHint[];
  /** True when the listing endpoint omits the description and `hydrate` must be called. */
  needsHydration?: boolean;
  /** Where `hydrate` finds the posting's details, when the id alone isn't enough. */
  ref?: string;
  /** Years of experience the board says the role needs; beats reading them from the text. */
  yearsMin?: number | null;
  /** Visa sponsorship the board states outright; the text's own statement still counts. */
  sponsorship?: "yes" | "no";
  /** The employer, for a feed of many employers' jobs. */
  employer?: string;
}

/**
 * A board's open postings. `complete` is false when the board couldn't list everything (it caps
 * searches, or a page failed), so postings missing from it must not be closed.
 */
export interface BoardListing {
  jobs: NormalizedJob[];
  complete: boolean;
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
  listJobs(boardToken: string, context: ConnectorContext): Promise<BoardListing>;
  /** New postings one sync may hydrate; boards that list thousands of jobs get more. */
  hydrationsPerSync?: number;
  /**
   * How many jobs the board has open, in a request or two: for checking a board found by
   * discovery without reading all of it. Boards read in one request just list their jobs.
   */
  countJobs?(boardToken: string, context: ConnectorContext): Promise<number>;
  /** Fetches full details for postings whose listing lacks a description. */
  hydrate?(
    boardToken: string,
    job: NormalizedJob,
    context: ConnectorContext,
  ): Promise<NormalizedJob>;
}
