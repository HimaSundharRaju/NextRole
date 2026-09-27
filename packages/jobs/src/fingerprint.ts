/*
 * The same job often turns up twice: on the employer's own board and in a feed of many
 * employers' jobs. A fingerprint of employer, title and place finds the pairs.
 */

/**
 * Words that tell one employer's legal names apart but not employers: "Amazon.com Services LLC"
 * and "Amazon" are the same employer to a job seeker.
 */
const GENERIC = new Set([
  "a",
  "and",
  "co",
  "com",
  "company",
  "corp",
  "corporation",
  "gmbh",
  "group",
  "holding",
  "holdings",
  "inc",
  "incorporated",
  "limited",
  "llc",
  "llp",
  "lp",
  "ltd",
  "n",
  "na",
  "of",
  "plc",
  "service",
  "services",
  "the",
  "us",
  "usa",
]);

function words(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean);
}

function employerKey(employer: string): string {
  const all = words(employer);
  const distinctive = all.filter((word) => !GENERIC.has(word));
  return (distinctive.length > 0 ? distinctive : all).join(" ");
}

/** The first place named, without the country and state codes some boards put first. */
function placeKey(location: string): string {
  const place = words(location.split(/[,/;|]/)[0] ?? "");
  while (place.length > 1 && place[0]!.length <= 2) place.shift();
  return place.join(" ") || "anywhere";
}

/**
 * Employer, title and the first place named, normalized: "Acme, Inc." / "Senior Engineer
 * (Payments)" / "San Francisco, CA" is `acme|senior engineer payments|san francisco`.
 */
export function jobFingerprint(employer: string, title: string, location: string): string {
  return `${employerKey(employer)}|${words(title).join(" ")}|${placeKey(location)}`;
}
