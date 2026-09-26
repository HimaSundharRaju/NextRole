import type { VisaSponsorship } from "@gettargetrole/db/schema";

export interface VisaSignals {
  sponsorship: VisaSponsorship;
  /** Citizenship or a security clearance is required. */
  citizenshipRequired: boolean;
}

// Only explicit statements count; most posts say nothing, which stays "unknown".
const NO_SPONSORSHIP = [
  /\b(?:unable|not able|cannot|can ?not|won['’]?t|will not|do(?:es)? not|don['’]?t|doesn['’]?t|are not in a position)\s+(?:to\s+)?(?:currently\s+)?(?:provide\s+|offer\s+|support\s+)?(?:any\s+)?(?:visa\s+|immigration\s+|employment\s+|work\s+)?sponsor(?:ship)?\b/i,
  /\bno\s+(?:visa\s+|immigration\s+)?sponsorship\b/i,
  /\b(?:visa\s+|immigration\s+)?sponsorship\s+(?:is\s+|will\s+)?not\s+(?:be\s+)?(?:available|provided|offered|possible|supported)\b/i,
  /\bwithout\s+(?:requiring\s+|needing\s+|the\s+need\s+for\s+|need\s+for\s+)?(?:current\s+or\s+future\s+|future\s+)?(?:visa\s+|employer\s+|employment\s+)?sponsorship\b/i,
  /\bnot\s+(?:eligible|able)\s+for\s+(?:visa\s+)?sponsorship\b/i,
  // Export-control roles need U.S. persons; a duty such as "advise on ITAR" says nothing about you.
  /\b(?:must|required to|need to)\s+be\s+(?:an?\s+)?U\.?S\.?\s+persons?\b|\bU\.?S\.?\s+persons?\s+(?:status\s+)?(?:is\s+)?(?:required|only)\b/i,
];
const OFFERS_SPONSORSHIP = [
  /\b(?:visa|immigration|H-?1B)\s+sponsorship\s+(?:is\s+|may be\s+|will be\s+)?(?:available|provided|offered|supported|possible)\b/i,
  /\b(?:we|will|can|able to|happy to|willing to|glad to)\s+(?:provide\s+|offer\s+|support\s+)?(?:visa|immigration|H-?1B)\s+sponsorship\b/i,
  /\b(?:we|will|can)\s+sponsor\s+(?:visas?|H-?1B|work\s+(?:visas?|permits?)|employment\s+visas?)\b/i,
  /\bH-?1B\s+(?:sponsorship|transfers?)\s+(?:is\s+|are\s+)?(?:available|supported|welcome|considered)\b/i,
  /\bsponsorship\s+(?:is\s+)?available\b/i,
];
const CITIZENSHIP = [
  /\b(?:U\.?S\.?\s+|United States\s+)?citizen(?:ship)?\s+(?:is\s+)?(?:required|only)\b/i,
  /\b(?:must|required to)\s+be\s+(?:a\s+)?(?:U\.?S\.?|United States)\s+citizen\b/i,
  /\b(?:active|current|existing|ability to obtain|able to obtain|obtain and maintain|eligible for)\s+(?:an?\s+)?(?:U\.?S\.?\s+)?(?:government\s+|federal\s+|DoD\s+)?(?:security\s+)?clearance\b/i,
  /\b(?:TS\/SCI|Top Secret|Secret|Public Trust)\s+(?:security\s+)?clearance\b/i,
];
// "Clearance … is a plus but not required" doesn't rule anyone out.
const OPTIONAL =
  /\bnot\s+(?:required|necessary|needed|mandatory)\b|\ba plus\b|\bbeneficial\b|\bnice to have\b|\bbonus\b/i;

/**
 * What a posting says about visas. A post that says both ("we sponsor in the UK but not the US")
 * stays "unknown", so filters never hide it by mistake.
 */
export function parseVisaSignals(description: string): VisaSignals {
  const refuses = NO_SPONSORSHIP.some((pattern) => pattern.test(description));
  const offers = OFFERS_SPONSORSHIP.some((pattern) => pattern.test(description));
  const citizenshipRequired = description
    .split(/(?<=[.!?])\s+|\n/)
    .some(
      (sentence) =>
        CITIZENSHIP.some((pattern) => pattern.test(sentence)) && !OPTIONAL.test(sentence),
    );
  return {
    sponsorship: refuses === offers ? "unknown" : refuses ? "no" : "yes",
    citizenshipRequired,
  };
}
