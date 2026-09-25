import type { AtsProvider } from "@gettargetrole/db/schema";
import { ashby } from "./ashby";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { smartrecruiters } from "./smartrecruiters";
import type { BoardConnector } from "./types";

export const CONNECTORS: Record<AtsProvider, BoardConnector> = {
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
};

export function getConnector(provider: AtsProvider): BoardConnector {
  return CONNECTORS[provider];
}

export { BoardNotFoundError, getJson, USER_AGENT } from "./http";
export { mapAshbyJob } from "./ashby";
export { mapGreenhouseJob } from "./greenhouse";
export { mapLeverPosting } from "./lever";
export { mapSmartRecruitersPosting } from "./smartrecruiters";
export type * from "./types";
