import type { VisaSponsorship } from "@gettargetrole/db/schema";

export interface VisaSignals {
  sponsorship: VisaSponsorship;
  /** Citizenship, a status such as permanent residency, or a security clearance is required. */
  citizenshipRequired: boolean;
}

/** The sentences that decided each label, for showing a person why; null when none did. */
export interface VisaEvidence {
  sponsorship: string | null;
  citizenship: string | null;
}

export interface VisaReading extends VisaSignals {
  evidence: VisaEvidence;
}

/*
 * Only explicit statements count; most posts say nothing, which stays "unknown". Every pattern
 * runs on one sentence at a time, so a statement is judged with the words around it and the
 * sentence that decided a label can be quoted.
 */

// "U.S.", "US" or "United States".
const US = String.raw`(?:U\.?S\.?A?|United\s+States(?:\s+of\s+America)?)`;

/* ---- Refusals: the post says it won't sponsor, or that only U.S. persons may apply ------------ */

const TO = String.raw`(?:(?:currently|presently|generally|successfully|always|actually)\s+)*`;
const NO_SPONSORSHIP = [
  // "unable to sponsor", "do not currently sponsor", "aren't able to successfully sponsor visas"
  new RegExp(
    String.raw`\b(?:unable|not able|cannot|can ?not|can['’]t|won['’]?t|will not|do(?:es)? not|don['’]?t|doesn['’]?t|(?:are|is|am) not|aren['’]t|isn['’]t)\s+(?:(?:currently|presently|generally)\s+|able\s+|in a position\s+|willing\s+)*(?:to\s+)?${TO}(?:provid(?:e|ing)\s+|offer(?:ing)?\s+|support(?:ing)?\s+|extend(?:ing)?\s+)?(?:any\s+)?(?:visa\s+|immigration\s+|employment\s+|work\s+)?sponsor(?:ship|ing)?\b`,
    "i",
  ),
  /\bno\s+(?:visa\s+|immigration\s+|H-?1-?B\s+)?sponsorship\b/i,
  /\b(?:visa\s+|immigration\s+)?sponsorship\s+(?:is\s+|are\s+|will\s+)?(?:currently\s+)?(?:not|isn['’]t|aren['’]t|won['’]t)\s+(?:be\s+)?(?:currently\s+)?(?:available|provided|offered|possible|supported)\b|\bsponsorship\s+(?:is|are)\s+unavailable\b/i,
  // "…without sponsorship for an export license" is about export controls, not visas.
  /\bwithout\s+(?:requiring\s+|needing\s+|the\s+need\s+for\s+|need\s+for\s+)?(?:current\s+or\s+future\s+|future\s+)?(?:visa\s+|employer\s+|employment\s+)?sponsorship\b(?!\s+(?:for|of)\s+(?:an?\s+|the\s+)?(?:export|import|licen[cs]e))/i,
  /\b(?:not\s+(?:eligible|able)|ineligible)\s+for\s+(?:(?:a\s+)?(?:work\s+)?visa(?:\s+or\s+relocation)?\s+(?:sponsorship|support|assistance)|(?:visa\s+)?sponsorship)\b/i,
  // "does not include employment sponsorship"
  /\b(?:does|do)\s+not\s+(?:include|come\s+with|have|carry)\s+(?:any\s+)?(?:visa\s+|employment\s+|work\s+|immigration\s+)(?:sponsorship|support)\b/i,
  // Export-control roles need U.S. persons; a duty such as "advise on ITAR" says nothing about you.
  /\b(?:must|required to|need to)\s+be\s+(?:an?\s+)?U\.?S\.?\s+persons?\b|\bU\.?S\.?\s+persons?\s+(?:status\s+)?(?:is\s+)?(?:required|only)\b/i,
];

/** "…not able to sponsor for every role" is a hedge, not a refusal. */
const PARTIAL_REFUSAL =
  /\bfor\s+(?:every|all|each)\s+(?:single\s+)?(?:role|position|candidate|applicant|opening|job|case|hire)s?\b/i;

/* ---- Offers: the post says it sponsors ------------------------------------------------------- */

const OFFERS_SPONSORSHIP = [
  /\b(?:visa|immigration|H-?1-?B)\s+sponsorship\s+(?:is\s+|are\s+|may be\s+|will be\s+|can be\s+)?(?:currently\s+|also\s+)?(?:available|provided|offered|supported|possible)\b/i,
  /\b(?:we|will|can|do|does|able to|happy to|willing to|glad to)\s+(?:also\s+)?(?:provide\s+|offer\s+|support\s+)?(?:visa|immigration|H-?1-?B)\s+sponsorship\b/i,
  // "We do sponsor visas!", "We sponsor H-1B visas." Relocation or events don't count.
  /\b(?:we|will|can|do|does|may|are\s+able\s+to|able\s+to|happy\s+to|willing\s+to|glad\s+to|open\s+to|ready\s+to)\s+(?:also\s+|gladly\s+|happily\s+|actively\s+)?sponsor(?:ing)?\s+(?:(?:work|employment)\s+)?(?:visas?|H-?1-?B|work\s+(?:permits?|authori[sz]ation)|green\s+cards?)\b/i,
  /\bH-?1-?B\s+(?:sponsorship|transfers?)\s+(?:is\s+|are\s+)?(?:available|supported|welcome|considered)\b/i,
  /\bsponsorship\s+(?:is\s+)?available\b/i,
  /\b(?:visa|immigration|work)\s+sponsorship\s*[:\-–—]\s*(?:yes|available|offered|provided|eligible)\b/i,
];

/* ---- Citizenship, status and clearance requirements ------------------------------------------ */

// Wording that names who may apply. Each is a requirement on its own; sentences that undo it
// ("not required", "or valid work authorization") are set aside below.
const WHO_MAY_APPLY = [
  // "U.S. citizenship is required", "citizens only"
  new RegExp(
    String.raw`\b(?:${US}\s+)?citizen(?:s|ship)?\s+(?:is\s+|are\s+)?(?:required|only|mandatory|a\s+(?:must|requirement))\b`,
    "i",
  ),
  // "must be U.S. citizens", "be a US Citizen on US Soil"
  new RegExp(String.raw`\bbe\s+(?:an?\s+)?${US}\s+citizens?\b`, "i"),
  new RegExp(String.raw`\bbe\s+(?:an?\s+)?citizens?\s+of\s+(?:the\s+)?${US}\b`, "i"),
  // "restricted to US citizens or lawful permanent residents", "only U.S. persons"
  new RegExp(
    String.raw`\b(?:restricted|limited|reserved)\s+(?:only\s+)?to\s+(?:${US}\s+)?(?:citizens?|persons?|nationals?)\b|\b(?:open|available|eligible)\s+(?:only|exclusively)\s+(?:to|for)\s+(?:${US}\s+)?(?:citizens?|persons?|nationals?)\b|\bonly\s+${US}\s+(?:citizens?|persons?)\b`,
    "i",
  ),
  // "this position requires U.S. citizenship"
  new RegExp(
    String.raw`\b(?:requires?|requiring)\s+${US}\s+(?:citizens?|citizenship|persons?)\b`,
    "i",
  ),
  // "Candidates who are not U.S. citizens are not eligible for consideration."
  new RegExp(
    String.raw`\b(?:non[-\s]?|not\s+)${US}\s+citizens?\b[^.]{0,80}?\b(?:not\s+(?:be\s+)?(?:eligible|considered|permitted|allowed|accepted)|ineligible|excluded)\b`,
    "i",
  ),
  // "Eligibility as a United States Person (U.S. citizen, lawful permanent resident, …)"
  new RegExp(String.raw`\b(?:eligib\w+|status)\s+as\s+(?:an?\s+)?${US}\s+persons?\b`, "i"),
  // A bullet that is only the requirement: "Be a US Citizen", "US Citizen", "Are a US person".
  new RegExp(
    String.raw`^(?:(?:be|are|is)\s+)?(?:an?\s+)?${US}\s+(?:citizens?|citizenship|persons?)\W*$`,
    "i",
  ),
  // "Must be eligible to access … ITAR / export-controlled materials": a foreign national isn't.
  /\beligib\w+\s+to\s+(?:access|work\s+with|receive|handle)\b[^.]{0,80}\b(?:ITAR|export[- ]controlled)\b/i,
];

// A sentence that lists citizens next to the other statuses is naming who may apply, when it also
// says it is a requirement ("must", "government contract", "export control").
const CITIZEN_WORD = /\bcitizens?\b/i;
const OTHER_STATUS =
  /\b(?:permanent\s+residen(?:ts?|ce|cy)|lawful\s+permanent|green\s*card|asylees?|refugees?|protected\s+individuals?)\b/i;
const IS_A_REQUIREMENT =
  /\b(?:must|only|restricted|limited|reserved|requires?|required|requirement|eligib\w+|open\s+to|available\s+to|considered|hir(?:e|ing)|to\s+comply|in\s+order\s+to|due\s+to|government|contract(?:ual)?|export|ITAR|mandate[sd]?)\b/i;

// Clearances are read as before: a requirement unless the sentence calls it optional.
const CLEARANCE = [
  /\b(?:active|current|existing|ability to obtain|able to obtain|obtain and maintain|eligible for)\s+(?:an?\s+)?(?:U\.?S\.?\s+)?(?:government\s+|federal\s+|DoD\s+)?(?:security\s+)?clearance\b/i,
  /\b(?:TS\/SCI|Top Secret|Secret|Public Trust)\s+(?:security\s+)?clearance\b/i,
];

// "Clearance … is a plus but not required" doesn't rule anyone out.
const OPTIONAL =
  /\bnot\s+(?:required|necessary|needed|mandatory)\b|\ba plus\b|\bbeneficial\b|\bnice to have\b|\bbonus\b/i;
// "We do not require U.S. citizenship", "need not be a citizen", "regardless of citizenship".
const NEGATED =
  /\bneed\s+not\b|\b(?:do(?:es)?\s+not|don['’]t|doesn['’]t)\s+(?:need|have|require)\b|\bno\s+need\b|\bnot\s+(?:be\s+)?(?:restricted|limited)\b|\bregardless\s+of\b|\bwhether\s+or\s+not\b/i;
// "A U.S. citizen or hold valid work authorization" also admits people on visas.
const WORK_AUTHORIZATION_ALTERNATIVE =
  /\b(?:or|and\/or)\b[^.]{0,80}\b(?:work\s+authori[sz]ation|authori[sz]ed\s+to\s+work|valid\s+(?:work\s+)?(?:visa|permit)|eligible\s+to\s+work|work\s+permit|legally\s+(?:authori[sz]ed|eligible)|right\s+to\s+work)\b/i;

/* ---- Reading a post -------------------------------------------------------------------------- */

const EVIDENCE_MAX_CHARS = 300;

/**
 * Sentences and bullet lines, trimmed of their bullet. A dotted initialism such as "U.S." never
 * ends a sentence (it used to cut "must be a U.S. citizen" in two); the rare sentence that really
 * ends with one is joined to the next.
 */
function sentencesOf(text: string): string[] {
  return text
    .replace(/\b(?:[A-Za-z]\.){2,}/g, (initialism) => initialism.replaceAll(".", "\u0000"))
    .split(/(?<=[.!?])\s+|\n/)
    .map((sentence) =>
      sentence
        .replaceAll("\u0000", ".")
        .replace(/^[\s•·▪●○◦*–—-]+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

const quote = (sentence: string) =>
  sentence.length > EVIDENCE_MAX_CHARS ? `${sentence.slice(0, EVIDENCE_MAX_CHARS)}…` : sentence;

function restrictsToCitizensOrStatuses(sentence: string): boolean {
  if (OPTIONAL.test(sentence) || NEGATED.test(sentence)) return false;
  if (WORK_AUTHORIZATION_ALTERNATIVE.test(sentence)) return false;
  if (WHO_MAY_APPLY.some((pattern) => pattern.test(sentence))) return true;
  return (
    CITIZEN_WORD.test(sentence) && OTHER_STATUS.test(sentence) && IS_A_REQUIREMENT.test(sentence)
  );
}

function requiresClearance(sentence: string): boolean {
  return CLEARANCE.some((pattern) => pattern.test(sentence)) && !OPTIONAL.test(sentence);
}

/**
 * What a posting says about visas, and the sentence behind each label. A post that says both ("we
 * sponsor in the UK but not the US") stays "unknown", so filters never hide it by mistake.
 */
export function explainVisaSignals(description: string): VisaReading {
  let refusal: string | null = null;
  let offer: string | null = null;
  let citizenship: string | null = null;

  for (const sentence of sentencesOf(description)) {
    // Offers are looked for in what's left once refusals are cut out, so "not able to sponsor
    // visas" isn't also an offer, while "we sponsor visas in the UK but cannot sponsor here" is both.
    let rest = sentence;
    let refuses = false;
    for (const pattern of NO_SPONSORSHIP) {
      if (pattern.test(rest)) {
        refuses = true;
        rest = rest.replace(pattern, " ");
      }
    }
    if (refuses && !PARTIAL_REFUSAL.test(sentence)) refusal ??= sentence;
    if (OFFERS_SPONSORSHIP.some((pattern) => pattern.test(rest))) offer ??= sentence;
    if (restrictsToCitizensOrStatuses(sentence) || requiresClearance(sentence)) {
      citizenship ??= sentence;
    }
  }

  // A role only citizens or U.S. persons can take doesn't sponsor, whatever the company's general
  // paragraph says: calling it "yes" would put it in the "Says it sponsors visas" filter.
  const sponsorship: VisaSponsorship =
    refusal !== null && offer === null
      ? "no"
      : offer !== null && refusal === null && citizenship === null
        ? "yes"
        : "unknown";
  return {
    sponsorship,
    citizenshipRequired: citizenship !== null,
    evidence: {
      sponsorship:
        sponsorship === "no" ? quote(refusal!) : sponsorship === "yes" ? quote(offer!) : null,
      citizenship: citizenship === null ? null : quote(citizenship),
    },
  };
}

/** What a posting says about visas. See `explainVisaSignals` for the sentences behind it. */
export function parseVisaSignals(description: string): VisaSignals {
  const { sponsorship, citizenshipRequired } = explainVisaSignals(description);
  return { sponsorship, citizenshipRequired };
}
