import { EMPLOYMENT_TYPES, type EmploymentType } from "@gettargetrole/db/schema";

/** Base arrangements, from the board's employment type or the title. */
const BASE: ReadonlyArray<readonly [RegExp, EmploymentType]> = [
  [/\bfull[- ]?time\b|\bpermanent\b|\bregular\b/i, "full_time"],
  [/\bpart[- ]?time\b/i, "part_time"],
  [/\bintern(?:ship)?s?\b|\bco-?op\b|\bapprentice(?:ship)?\b/i, "internship"],
  [/\bcontract(?:or)?\b|\bfreelance\b/i, "contract"],
  [/\btemp(?:orary)?\b|\bfixed[- ]term\b|\bseasonal\b/i, "temporary"],
];

// W-2, C2C and 1099 count only when the post uses them as an arrangement ("W2 only", "open to
// C2C", "1099 contract"), not in duties such as "prepare W-2 forms".
const W2 =
  /\bW-?2\b(?=[^.\n]{0,40}\b(?:only|contracts?|positions?|roles?|basis|employment|hourly|candidates?)\b)|\b(?:on|via|through|as)\s+(?:a\s+)?W-?2\b|\bW-?2\s*(?:\/|or|,|and)\s*(?:C2C|1099|corp)|\b(?:C2C|1099)\s*(?:\/|or|,|and)\s*W-?2\b/i;
const C2C = /\bC2C\b|\bcorp(?:oration)?[- ]to[- ]corp(?:oration)?\b/i;
const TEN99 =
  /\b1099\b(?=[^.\n]{0,40}\b(?:only|contracts?|contractors?|positions?|roles?|basis)\b)|\b(?:on|via|through|as)\s+(?:a\s+)?1099\b|\b1099\s*(?:\/|or|,|and)\s*(?:W-?2|C2C)|\b(?:W-?2|C2C)\s*(?:\/|or|,|and)\s*1099\b/i;
const NO_C2C =
  /\b(?:no|not|without)\s+(?:C2C|corp[- ]to[- ]corp)\b|\b(?:C2C|corp[- ]to[- ]corp)\s+(?:is\s+|are\s+)?not\b|\bW-?2\s+only\b/i;
const NO_1099 = /\b(?:no|not)\s+1099\b|\bW-?2\s+only\b/i;
const NO_W2 = /\b(?:no|not)\s+W-?2\b|\b(?:C2C|1099)\s+only\b/i;

/**
 * Employment arrangements for a posting. The board's declared type and the title give the base
 * arrangement; W-2, C2C and 1099 come from explicit mentions in the description. Company boards
 * mostly leave the type blank for regular roles, so a post with no other signal is full-time.
 */
export function parseEmploymentTypes(
  declared: string,
  title: string,
  description: string,
): EmploymentType[] {
  const types = new Set<EmploymentType>();
  for (const [pattern, type] of BASE) {
    if (pattern.test(declared) || (type !== "full_time" && pattern.test(title))) types.add(type);
  }
  const hasBase = types.size > 0;
  if (W2.test(description) && !NO_W2.test(description)) types.add("w2");
  if (C2C.test(description) && !NO_C2C.test(description)) types.add("c2c");
  if (TEN99.test(description) && !NO_1099.test(description)) types.add("1099");
  if (!hasBase) {
    // W-2, C2C and 1099 mentions come from contract roles; otherwise assume a regular role.
    types.add(types.size > 0 ? "contract" : "full_time");
  }
  return EMPLOYMENT_TYPES.filter((type) => types.has(type));
}
