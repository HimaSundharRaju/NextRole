/**
 * Country and state detection for job locations, without network or AI calls. Structured hints
 * from the job board win; free text ("San Francisco, CA", "Remote - US", "Bengaluru") is matched
 * against countries, states and provinces, and major tech cities. Output uses ISO 3166 codes:
 * countries as "US", states and provinces as "US-CA".
 */

export interface PlaceHint {
  /** Country name or ISO code, as the board reports it. */
  country?: string | null;
  /** State or province name or code. */
  region?: string | null;
  city?: string | null;
}

export interface Places {
  countries: string[];
  regions: string[];
}

// ISO code, display name, then other spellings.
// prettier-ignore
const COUNTRIES: ReadonlyArray<readonly [string, string, ...string[]]> = [
  ["US", "United States", "USA", "U.S.", "U.S.A.", "United States of America", "America"],
  ["CA", "Canada"],
  ["MX", "Mexico", "México"],
  ["BR", "Brazil", "Brasil"],
  ["AR", "Argentina"],
  ["CL", "Chile"],
  ["CO", "Colombia"],
  ["PE", "Peru"],
  ["UY", "Uruguay"],
  ["CR", "Costa Rica"],
  ["GB", "United Kingdom", "UK", "U.K.", "Great Britain", "Britain", "England", "Scotland", "Wales", "Northern Ireland"],
  ["IE", "Ireland"],
  ["FR", "France"],
  ["DE", "Germany", "Deutschland"],
  ["NL", "Netherlands", "The Netherlands", "Holland"],
  ["BE", "Belgium"],
  ["LU", "Luxembourg"],
  ["CH", "Switzerland"],
  ["AT", "Austria"],
  ["ES", "Spain", "España"],
  ["PT", "Portugal"],
  ["IT", "Italy", "Italia"],
  ["SE", "Sweden"],
  ["NO", "Norway"],
  ["DK", "Denmark"],
  ["FI", "Finland"],
  ["IS", "Iceland"],
  ["PL", "Poland"],
  ["CZ", "Czech Republic", "Czechia"],
  ["SK", "Slovakia"],
  ["HU", "Hungary"],
  ["RO", "Romania"],
  ["BG", "Bulgaria"],
  ["GR", "Greece"],
  ["TR", "Turkey", "Türkiye"],
  ["UA", "Ukraine"],
  ["EE", "Estonia"],
  ["LV", "Latvia"],
  ["LT", "Lithuania"],
  ["RS", "Serbia"],
  ["HR", "Croatia"],
  ["SI", "Slovenia"],
  ["CY", "Cyprus"],
  ["MT", "Malta"],
  ["IL", "Israel"],
  ["AE", "United Arab Emirates", "UAE", "U.A.E."],
  ["SA", "Saudi Arabia", "KSA"],
  ["QA", "Qatar"],
  ["EG", "Egypt"],
  ["ZA", "South Africa"],
  ["NG", "Nigeria"],
  ["KE", "Kenya"],
  ["MA", "Morocco"],
  ["IN", "India"],
  ["PK", "Pakistan"],
  ["BD", "Bangladesh"],
  ["LK", "Sri Lanka"],
  ["SG", "Singapore"],
  ["MY", "Malaysia"],
  ["ID", "Indonesia"],
  ["TH", "Thailand"],
  ["VN", "Vietnam", "Viet Nam"],
  ["PH", "Philippines"],
  ["JP", "Japan"],
  ["KR", "South Korea", "Korea", "Republic of Korea"],
  ["CN", "China", "Mainland China"],
  ["HK", "Hong Kong", "Hong Kong SAR"],
  ["TW", "Taiwan"],
  ["AU", "Australia"],
  ["NZ", "New Zealand"],
];

// Country code -> [region code, display name, other spellings...].
// prettier-ignore
const REGIONS: Record<string, ReadonlyArray<readonly [string, string, ...string[]]>> = {
  US: [
    ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
    ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
    ["DC", "District of Columbia", "Washington DC", "Washington, DC", "Washington D.C.", "Washington, D.C."],
    ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
    ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
    ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"],
    ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
    ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
    ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"],
    ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"],
    ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"],
    ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
    ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"], ["PR", "Puerto Rico"],
  ],
  CA: [
    ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
    ["NL", "Newfoundland and Labrador", "Newfoundland"], ["NS", "Nova Scotia"], ["ON", "Ontario"],
    ["PE", "Prince Edward Island"], ["QC", "Quebec", "Québec"], ["SK", "Saskatchewan"],
    ["NT", "Northwest Territories"], ["NU", "Nunavut"], ["YT", "Yukon"],
  ],
  IN: [
    ["KA", "Karnataka"], ["MH", "Maharashtra"], ["TG", "Telangana"], ["TN", "Tamil Nadu"],
    ["DL", "Delhi", "NCR", "Delhi NCR"], ["HR", "Haryana"], ["UP", "Uttar Pradesh"],
    ["GJ", "Gujarat"], ["WB", "West Bengal"], ["KL", "Kerala"], ["RJ", "Rajasthan"],
    ["AP", "Andhra Pradesh"], ["PB", "Punjab"], ["OD", "Odisha"], ["MP", "Madhya Pradesh"],
    ["GA", "Goa"],
  ],
  AU: [
    ["NSW", "New South Wales"], ["VIC", "Victoria"], ["QLD", "Queensland"],
    ["WA", "Western Australia"], ["SA", "South Australia"], ["TAS", "Tasmania"],
    ["ACT", "Australian Capital Territory"], ["NT", "Northern Territory"],
  ],
};

// City -> country, plus region where the country has regions above.
// prettier-ignore
const CITIES: ReadonlyArray<readonly [string, string, string?]> = [
  ["San Francisco", "US", "CA"], ["SF", "US", "CA"], ["Bay Area", "US", "CA"],
  ["San Francisco Bay Area", "US", "CA"], ["Silicon Valley", "US", "CA"],
  ["South San Francisco", "US", "CA"], ["San Jose", "US", "CA"], ["SEA", "US", "WA"],
  ["CHI", "US", "IL"], ["CDMX", "MX"],
  ["Palo Alto", "US", "CA"], ["Mountain View", "US", "CA"], ["Menlo Park", "US", "CA"],
  ["Sunnyvale", "US", "CA"], ["Santa Clara", "US", "CA"], ["Cupertino", "US", "CA"],
  ["Redwood City", "US", "CA"], ["San Mateo", "US", "CA"], ["Oakland", "US", "CA"],
  ["Berkeley", "US", "CA"], ["Los Angeles", "US", "CA"], ["Santa Monica", "US", "CA"],
  ["San Diego", "US", "CA"], ["Irvine", "US", "CA"], ["Seattle", "US", "WA"],
  ["Bellevue", "US", "WA"], ["Redmond", "US", "WA"], ["Kirkland", "US", "WA"],
  ["New York", "US", "NY"], ["New York City", "US", "NY"], ["NYC", "US", "NY"],
  ["Brooklyn", "US", "NY"], ["Boston", "US", "MA"], ["Chicago", "US", "IL"],
  ["Austin", "US", "TX"], ["Dallas", "US", "TX"], ["Houston", "US", "TX"],
  ["Denver", "US", "CO"], ["Boulder", "US", "CO"], ["Atlanta", "US", "GA"], ["Miami", "US", "FL"],
  ["Washington", "US", "DC"], ["Arlington", "US", "VA"], ["Reston", "US", "VA"],
  ["Philadelphia", "US", "PA"], ["Pittsburgh", "US", "PA"], ["Portland", "US", "OR"],
  ["Salt Lake City", "US", "UT"], ["Lehi", "US", "UT"], ["Phoenix", "US", "AZ"],
  ["Minneapolis", "US", "MN"], ["Detroit", "US", "MI"], ["Ann Arbor", "US", "MI"],
  ["Nashville", "US", "TN"], ["Raleigh", "US", "NC"], ["Durham", "US", "NC"],
  ["Charlotte", "US", "NC"], ["Columbus", "US", "OH"], ["Toronto", "CA", "ON"],
  ["Ottawa", "CA", "ON"], ["Waterloo", "CA", "ON"], ["Vancouver", "CA", "BC"],
  ["Montreal", "CA", "QC"], ["Montréal", "CA", "QC"], ["Calgary", "CA", "AB"],
  ["London", "GB"], ["Edinburgh", "GB"], ["Manchester", "GB"], ["Belfast", "GB"],
  ["Dublin", "IE"], ["Cork", "IE"], ["Paris", "FR"], ["Berlin", "DE"], ["Munich", "DE"],
  ["München", "DE"], ["Hamburg", "DE"], ["Frankfurt", "DE"], ["Amsterdam", "NL"],
  ["Rotterdam", "NL"], ["Brussels", "BE"], ["Zurich", "CH"], ["Zürich", "CH"],
  ["Geneva", "CH"], ["Vienna", "AT"], ["Madrid", "ES"], ["Barcelona", "ES"], ["Lisbon", "PT"],
  ["Milan", "IT"], ["Rome", "IT"], ["Stockholm", "SE"], ["Copenhagen", "DK"], ["Oslo", "NO"],
  ["Helsinki", "FI"], ["Warsaw", "PL"], ["Krakow", "PL"], ["Kraków", "PL"], ["Prague", "CZ"],
  ["Budapest", "HU"], ["Bucharest", "RO"], ["Athens", "GR"], ["Istanbul", "TR"],
  ["Tallinn", "EE"], ["Tel Aviv", "IL"], ["Dubai", "AE"], ["Abu Dhabi", "AE"],
  ["Riyadh", "SA"], ["Cape Town", "ZA"], ["Johannesburg", "ZA"], ["Lagos", "NG"],
  ["Nairobi", "KE"], ["Bangalore", "IN", "KA"], ["Bengaluru", "IN", "KA"],
  ["Hyderabad", "IN", "TG"], ["Mumbai", "IN", "MH"], ["Pune", "IN", "MH"],
  ["Chennai", "IN", "TN"], ["New Delhi", "IN", "DL"], ["Gurgaon", "IN", "HR"],
  ["Gurugram", "IN", "HR"], ["Noida", "IN", "UP"], ["Kolkata", "IN", "WB"],
  ["Ahmedabad", "IN", "GJ"], ["Singapore", "SG"], ["Kuala Lumpur", "MY"], ["Jakarta", "ID"],
  ["Bangkok", "TH"], ["Manila", "PH"], ["Ho Chi Minh City", "VN"], ["Hanoi", "VN"],
  ["Tokyo", "JP"], ["Osaka", "JP"], ["Seoul", "KR"], ["Beijing", "CN"], ["Shanghai", "CN"],
  ["Shenzhen", "CN"], ["Taipei", "TW"], ["Sydney", "AU", "NSW"], ["Melbourne", "AU", "VIC"],
  ["Brisbane", "AU", "QLD"], ["Perth", "AU", "WA"], ["Auckland", "NZ"], ["Wellington", "NZ"],
  ["São Paulo", "BR"], ["Sao Paulo", "BR"], ["Rio de Janeiro", "BR"], ["Mexico City", "MX"],
  ["Ciudad de México", "MX"], ["Guadalajara", "MX"], ["Buenos Aires", "AR"],
  ["Bogotá", "CO"], ["Bogota", "CO"], ["Medellín", "CO"], ["Lima", "PE"],
];

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const countryByName = new Map<string, string>();
const countryName = new Map<string, string>();
for (const [code, name, ...aliases] of COUNTRIES) {
  countryName.set(code, name);
  for (const alias of [name, ...aliases]) countryByName.set(fold(alias), code);
}

const regionByName = new Map<string, Map<string, string>>(); // country -> folded name -> code
const regionName = new Map<string, string>(); // "US-CA" -> "California"
for (const [country, regions] of Object.entries(REGIONS)) {
  const byName = new Map<string, string>();
  for (const [code, name, ...aliases] of regions) {
    regionName.set(`${country}-${code}`, name);
    byName.set(fold(code), code);
    for (const alias of [name, ...aliases]) byName.set(fold(alias), code);
  }
  regionByName.set(country, byName);
}

const cityByName = new Map<string, { country: string; region?: string }>();
for (const [name, country, region] of CITIES) cityByName.set(fold(name), { country, region });

// Long country names and short upper-case forms (US, UK, UAE) found anywhere in a phrase such as
// "Remote in the United States" or "Remote - US".
const LONG_COUNTRY_NAMES = [...countryByName.keys()].filter((name) => name.length > 3);
const SHORT_COUNTRY = /\b(US|USA|UK|UAE|KSA)\b/g;

/** ISO code for a country name or code, or null. */
export function countryCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed) && countryName.has(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }
  return countryByName.get(fold(trimmed)) ?? null;
}

function regionCode(country: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const code = regionByName.get(country)?.get(fold(value));
  return code ? `${country}-${code}` : null;
}

class Collector {
  readonly countries = new Set<string>();
  readonly regions = new Set<string>();
  addCountry(code: string | null) {
    if (code) this.countries.add(code);
  }
  addRegion(code: string | null) {
    if (!code) return;
    this.regions.add(code);
    this.countries.add(code.split("-")[0]!);
  }
  get empty() {
    return this.countries.size === 0;
  }
}

const REGION_COUNTRIES = ["US", "CA", "AU", "IN"];

/**
 * One place such as "Austin, TX", "Perth, WA", "Bengaluru, Karnataka, India" or "Dublin". The
 * trailing parts (state, country) are read first; a leading city only counts when it agrees with
 * them, so "Dublin, CA" is California and "London, ON" is Ontario.
 */
function parseSegment(segment: string, out: Collector): void {
  const parts = segment
    .split(",")
    .map((part) => part.replace(/[()]/g, " ").trim())
    .filter(Boolean);
  const found = new Collector();
  const statedRegions: string[] = []; // regions written out, as in "Austin, TX"
  const city = parts[0] ? cityByName.get(fold(parts[0])) : undefined;
  const regionOrder = [...new Set([...(city ? [city.country] : []), ...REGION_COUNTRIES])];

  for (const part of parts.slice(1).reverse()) {
    const short = /^[A-Z]{2,3}$/.test(part);
    const country = part.length > 2 ? countryCode(part) : null;
    if (country) {
      found.addCountry(country);
      continue;
    }
    const order = found.empty ? regionOrder : [...found.countries];
    const region = order.map((code) => regionCode(code, part)).find(Boolean);
    if (region && (short || part.length > 3)) {
      found.addRegion(region);
      statedRegions.push(region);
      continue;
    }
    // Lists of cities: "SF, NYC, Seattle".
    const listed = cityByName.get(fold(part));
    if (listed) {
      found.addCountry(listed.country);
      found.addRegion(listed.region ? `${listed.country}-${listed.region}` : null);
      continue;
    }
    if (short) found.addCountry(countryCode(part));
  }

  const first = parts[0];
  if (first) {
    if (city && (found.empty || found.countries.has(city.country))) {
      found.addCountry(city.country);
      // "Arlington, TX" is in Texas even though a bare "Arlington" means Virginia.
      const stated = statedRegions.some((code) => code.startsWith(`${city.country}-`));
      if (city.region && !stated) found.addRegion(`${city.country}-${city.region}`);
    } else if (!city) {
      const country = first.length > 2 ? countryCode(first) : null;
      if (country) found.addCountry(country);
      else if (first.length > 3 && found.empty) {
        found.addRegion(
          REGION_COUNTRIES.map((code) => regionCode(code, first)).find(Boolean) ?? null,
        );
      }
    }
  }
  if (found.empty) {
    const folded = fold(segment);
    for (const name of LONG_COUNTRY_NAMES) {
      if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(folded)) {
        found.addCountry(countryByName.get(name)!);
      }
    }
    for (const match of segment.matchAll(SHORT_COUNTRY)) found.addCountry(countryCode(match[1]));
  }
  for (const code of found.countries) out.countries.add(code);
  for (const code of found.regions) out.regions.add(code);
}

/** Countries and regions for a posting, from board-supplied hints and its location text. */
export function parseLocations(
  texts: Array<string | null | undefined>,
  hints: PlaceHint[] = [],
): Places {
  const out = new Collector();
  for (const hint of hints) {
    const country =
      countryCode(hint.country) ??
      (hint.city ? cityByName.get(fold(hint.city))?.country : null) ??
      null;
    if (!country) continue;
    out.addCountry(country);
    out.addRegion(regionCode(country, hint.region));
    if (!hint.region && hint.city) {
      const city = cityByName.get(fold(hint.city));
      if (city?.country === country && city.region) out.addRegion(`${country}-${city.region}`);
    }
  }
  for (const text of texts) {
    if (!text) continue;
    // "or" splits "Dublin OR London" but not "Portland, OR", where it follows a comma.
    for (const segment of text.split(/\s*(?:\/|;|\||•|\n|\s-\s|\s–\s)\s*|(?<!,)\s+or\s+/i)) {
      if (segment.trim()) parseSegment(segment, out);
    }
  }
  return { countries: [...out.countries].sort(), regions: [...out.regions].sort() };
}

/** Display name for an ISO country code ("US" -> "United States"). */
export function countryLabel(code: string): string {
  return countryName.get(code) ?? code;
}

/** Display name for an ISO region code ("US-CA" -> "California"). */
export function regionLabel(code: string): string {
  return regionName.get(code) ?? code;
}
