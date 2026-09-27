import type { AtsProvider } from "@gettargetrole/db/schema";
import { amazon } from "./amazon";
import { ashby } from "./ashby";
import { bullhorn } from "./bullhorn";
import { eightfold } from "./eightfold";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { oracle } from "./oracle";
import { smartrecruiters } from "./smartrecruiters";
import type { BoardConnector } from "./types";
import { workday } from "./workday";

export const CONNECTORS: Record<AtsProvider, BoardConnector> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workday,
  oracle,
  eightfold,
  amazon,
  bullhorn,
};

export function getConnector(provider: AtsProvider): BoardConnector {
  return CONNECTORS[provider];
}

export { BoardNotFoundError, getJson, USER_AGENT } from "./http";
export { boardFetch, politeFetch } from "./polite";
export { isPrivateAddress, publicOnly } from "./public-only";
export { mapAshbyJob } from "./ashby";
export { mapGreenhouseJob } from "./greenhouse";
export { mapLeverPosting } from "./lever";
export { mapSmartRecruitersPosting } from "./smartrecruiters";
export type * from "./types";
