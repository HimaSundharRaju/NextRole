import { createHash } from "node:crypto";
import { findSkills } from "@gettargetrole/resume/skills";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { companies, jobs, type AtsProvider } from "./schema";
import { slugify } from "./slug";

/**
 * Public job boards GetTargetRole ingests out of the box. Admins can add more from the admin console;
 * a wrong board token only marks that company's sync as failed.
 */
export const DEFAULT_COMPANIES: Array<{
  name: string;
  ats: AtsProvider;
  boardToken: string;
  website: string;
  /** For boards that take many requests to read; see `companies.sync_interval_minutes`. */
  syncIntervalMinutes?: number;
  isStaffingAgency?: boolean;
}> = [
  {
    name: "Anthropic",
    ats: "greenhouse",
    boardToken: "anthropic",
    website: "https://www.anthropic.com",
  },
  { name: "Airbnb", ats: "greenhouse", boardToken: "airbnb", website: "https://www.airbnb.com" },
  { name: "Stripe", ats: "greenhouse", boardToken: "stripe", website: "https://stripe.com" },
  { name: "Figma", ats: "greenhouse", boardToken: "figma", website: "https://www.figma.com" },
  { name: "Discord", ats: "greenhouse", boardToken: "discord", website: "https://discord.com" },
  { name: "Dropbox", ats: "greenhouse", boardToken: "dropbox", website: "https://www.dropbox.com" },
  {
    name: "Robinhood",
    ats: "greenhouse",
    boardToken: "robinhood",
    website: "https://robinhood.com",
  },
  {
    name: "Coinbase",
    ats: "greenhouse",
    boardToken: "coinbase",
    website: "https://www.coinbase.com",
  },
  { name: "Lyft", ats: "greenhouse", boardToken: "lyft", website: "https://www.lyft.com" },
  { name: "Reddit", ats: "greenhouse", boardToken: "reddit", website: "https://www.redditinc.com" },
  {
    name: "Databricks",
    ats: "greenhouse",
    boardToken: "databricks",
    website: "https://www.databricks.com",
  },
  {
    name: "Cloudflare",
    ats: "greenhouse",
    boardToken: "cloudflare",
    website: "https://www.cloudflare.com",
  },
  { name: "GitLab", ats: "greenhouse", boardToken: "gitlab", website: "https://about.gitlab.com" },
  {
    name: "Pinterest",
    ats: "greenhouse",
    boardToken: "pinterest",
    website: "https://www.pinterest.com",
  },
  { name: "Asana", ats: "greenhouse", boardToken: "asana", website: "https://asana.com" },
  { name: "Brex", ats: "greenhouse", boardToken: "brex", website: "https://www.brex.com" },
  { name: "Gusto", ats: "greenhouse", boardToken: "gusto", website: "https://gusto.com" },
  { name: "MongoDB", ats: "greenhouse", boardToken: "mongodb", website: "https://www.mongodb.com" },
  { name: "Palantir", ats: "lever", boardToken: "palantir", website: "https://www.palantir.com" },
  { name: "Plaid", ats: "ashby", boardToken: "plaid", website: "https://plaid.com" },
  { name: "OpenAI", ats: "ashby", boardToken: "openai", website: "https://openai.com" },
  { name: "Notion", ats: "ashby", boardToken: "notion", website: "https://www.notion.so" },
  { name: "Ramp", ats: "ashby", boardToken: "ramp", website: "https://ramp.com" },
  { name: "Linear", ats: "ashby", boardToken: "linear", website: "https://linear.app" },
  { name: "Supabase", ats: "ashby", boardToken: "supabase", website: "https://supabase.com" },
  { name: "PostHog", ats: "ashby", boardToken: "posthog", website: "https://posthog.com" },
  { name: "Visa", ats: "smartrecruiters", boardToken: "Visa", website: "https://www.visa.com" },
  // Large employers on Workday, Oracle, Eightfold, SmartRecruiters and amazon.jobs, verified live
  // (September 2026).
  {
    name: "3M",
    ats: "workday",
    boardToken: "3m.wd1.myworkdayjobs.com|3m|Search",
    website: "https://www.3m.com",
  },
  {
    name: "Abbott",
    ats: "workday",
    boardToken: "abbott.wd5.myworkdayjobs.com|abbott|abbottcareers",
    website: "https://www.abbott.com",
  },
  {
    name: "Adobe",
    ats: "workday",
    boardToken: "adobe.wd5.myworkdayjobs.com|adobe|external_experienced",
    website: "https://www.adobe.com",
  },
  { name: "Amazon", ats: "amazon", boardToken: "all", website: "https://www.amazon.jobs" },
  {
    name: "Autodesk",
    ats: "workday",
    boardToken: "autodesk.wd1.myworkdayjobs.com|autodesk|Ext",
    website: "https://www.autodesk.com",
  },
  {
    name: "Bank of America",
    ats: "workday",
    boardToken: "ghr.wd1.myworkdayjobs.com|ghr|Lateral-US",
    website: "https://www.bankofamerica.com",
  },
  {
    name: "Barclays",
    ats: "workday",
    boardToken: "barclays.wd3.myworkdayjobs.com|barclays|External_Career_Site_Barclays",
    website: "https://home.barclays",
  },
  {
    name: "BlackRock",
    ats: "workday",
    boardToken: "blackrock.wd1.myworkdayjobs.com|blackrock|BlackRock_Professional",
    website: "https://www.blackrock.com",
  },
  {
    name: "Boeing",
    ats: "workday",
    boardToken: "boeing.wd1.myworkdayjobs.com|boeing|EXTERNAL_CAREERS",
    website: "https://www.boeing.com",
  },
  {
    name: "Bosch",
    ats: "smartrecruiters",
    boardToken: "BoschGroup",
    website: "https://www.bosch.com",
    syncIntervalMinutes: 180,
  },
  {
    name: "Broadcom",
    ats: "workday",
    boardToken: "broadcom.wd1.myworkdayjobs.com|broadcom|External_Career",
    website: "https://www.broadcom.com",
  },
  {
    name: "Capital One",
    ats: "workday",
    boardToken: "capitalone.wd12.myworkdayjobs.com|capitalone|Capital_One",
    website: "https://www.capitalone.com",
  },
  {
    name: "Chevron",
    ats: "workday",
    boardToken: "chevron.wd5.myworkdayjobs.com|chevron|jobs",
    website: "https://www.chevron.com",
  },
  {
    name: "Cisco",
    ats: "workday",
    boardToken: "cisco.wd5.myworkdayjobs.com|cisco|Cisco_Careers",
    website: "https://www.cisco.com",
  },
  {
    name: "Citi",
    ats: "workday",
    boardToken: "citi.wd5.myworkdayjobs.com|citi|2",
    website: "https://www.citigroup.com",
  },
  {
    name: "CrowdStrike",
    ats: "workday",
    boardToken: "crowdstrike.wd5.myworkdayjobs.com|crowdstrike|crowdstrikecareers",
    website: "https://www.crowdstrike.com",
  },
  {
    name: "Deutsche Bank",
    ats: "workday",
    boardToken: "db.wd3.myworkdayjobs.com|db|DBWebSite",
    website: "https://www.db.com",
  },
  {
    name: "Disney",
    ats: "workday",
    boardToken: "disney.wd5.myworkdayjobs.com|disney|disneycareer",
    website: "https://www.disneycareers.com",
  },
  {
    name: "Fidelity Investments",
    ats: "workday",
    boardToken: "fmr.wd1.myworkdayjobs.com|fmr|FidelityCareers",
    website: "https://www.fidelity.com",
  },
  {
    name: "FIS",
    ats: "workday",
    boardToken: "fis.wd5.myworkdayjobs.com|fis|SearchJobs",
    website: "https://www.fisglobal.com",
  },
  {
    name: "Fiserv",
    ats: "workday",
    boardToken: "fiserv.wd5.myworkdayjobs.com|fiserv|EXT",
    website: "https://www.fiserv.com",
  },
  {
    name: "General Motors",
    ats: "workday",
    boardToken: "generalmotors.wd5.myworkdayjobs.com|generalmotors|Careers_GM",
    website: "https://www.gm.com",
  },
  {
    name: "HP",
    ats: "workday",
    boardToken: "hp.wd5.myworkdayjobs.com|hp|ExternalCareerSite",
    website: "https://www.hp.com",
  },
  {
    name: "Intel",
    ats: "workday",
    boardToken: "intel.wd1.myworkdayjobs.com|intel|External",
    website: "https://www.intel.com",
  },
  {
    name: "Johnson & Johnson",
    ats: "workday",
    boardToken: "jj.wd5.myworkdayjobs.com|jj|JJ",
    website: "https://www.jnj.com",
  },
  {
    name: "JPMorgan Chase",
    ats: "oracle",
    boardToken: "jpmc.fa.oraclecloud.com|CX_1001",
    website: "https://www.jpmorganchase.com",
  },
  {
    name: "Mastercard",
    ats: "workday",
    boardToken: "mastercard.wd1.myworkdayjobs.com|mastercard|CorporateCareers",
    website: "https://www.mastercard.com",
  },
  {
    name: "McDonald's",
    ats: "smartrecruiters",
    boardToken: "McDonaldsCorporation",
    website: "https://corporate.mcdonalds.com",
  },
  {
    name: "Merck",
    ats: "workday",
    boardToken: "msd.wd5.myworkdayjobs.com|msd|SearchJobs",
    website: "https://www.merck.com",
  },
  {
    name: "Micron",
    ats: "workday",
    boardToken: "micron.wd1.myworkdayjobs.com|micron|External",
    website: "https://www.micron.com",
  },
  {
    name: "Microsoft",
    ats: "eightfold",
    boardToken: "apply.careers.microsoft.com|microsoft.com|pcsx",
    website: "https://www.microsoft.com",
  },
  {
    name: "Morgan Stanley",
    ats: "workday",
    boardToken: "ms.wd5.myworkdayjobs.com|ms|External",
    website: "https://www.morganstanley.com",
  },
  {
    name: "Motorola Solutions",
    ats: "workday",
    boardToken: "motorolasolutions.wd5.myworkdayjobs.com|motorolasolutions|Careers",
    website: "https://www.motorolasolutions.com",
  },
  {
    name: "Nasdaq",
    ats: "workday",
    boardToken: "nasdaq.wd1.myworkdayjobs.com|nasdaq|Global_External_Site",
    website: "https://www.nasdaq.com",
  },
  {
    name: "Netflix",
    ats: "eightfold",
    boardToken: "explore.jobs.netflix.net|netflix.com",
    website: "https://www.netflix.com",
  },
  {
    name: "Nike",
    ats: "workday",
    boardToken: "nike.wd1.myworkdayjobs.com|nike|nke",
    website: "https://www.nike.com",
  },
  {
    name: "Northrop Grumman",
    ats: "workday",
    boardToken: "ngc.wd1.myworkdayjobs.com|ngc|Northrop_Grumman_External_Site",
    website: "https://www.northropgrumman.com",
  },
  {
    name: "NVIDIA",
    ats: "workday",
    boardToken: "nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite",
    website: "https://www.nvidia.com",
  },
  {
    name: "Oracle",
    ats: "oracle",
    boardToken: "eeho.fa.us2.oraclecloud.com|CX_45001",
    website: "https://www.oracle.com",
  },
  {
    name: "PayPal",
    ats: "workday",
    boardToken: "paypal.wd1.myworkdayjobs.com|paypal|jobs",
    website: "https://www.paypal.com",
  },
  {
    name: "Pfizer",
    ats: "workday",
    boardToken: "pfizer.wd1.myworkdayjobs.com|pfizer|PfizerCareers",
    website: "https://www.pfizer.com",
  },
  {
    name: "PNC",
    ats: "workday",
    boardToken: "pnc.wd5.myworkdayjobs.com|pnc|External",
    website: "https://www.pnc.com",
  },
  {
    name: "Qualcomm",
    ats: "eightfold",
    boardToken: "careers.qualcomm.com|qualcomm.com|pcsx",
    website: "https://www.qualcomm.com",
  },
  {
    name: "Red Hat",
    ats: "workday",
    boardToken: "redhat.wd5.myworkdayjobs.com|redhat|jobs",
    website: "https://www.redhat.com",
  },
  {
    name: "RTX",
    ats: "workday",
    boardToken: "globalhr.wd5.myworkdayjobs.com|globalhr|REC_RTX_Ext_Gateway",
    website: "https://www.rtx.com",
  },
  {
    name: "S&P Global",
    ats: "workday",
    boardToken: "spgi.wd5.myworkdayjobs.com|spgi|SPGI_Careers",
    website: "https://www.spglobal.com",
  },
  {
    name: "Salesforce",
    ats: "workday",
    boardToken: "salesforce.wd12.myworkdayjobs.com|salesforce|External_Career_Site",
    website: "https://www.salesforce.com",
  },
  {
    name: "ServiceNow",
    ats: "smartrecruiters",
    boardToken: "ServiceNow",
    website: "https://www.servicenow.com",
  },
  {
    name: "State Street",
    ats: "workday",
    boardToken: "statestreet.wd1.myworkdayjobs.com|statestreet|Global",
    website: "https://www.statestreet.com",
  },
  {
    name: "Ubisoft",
    ats: "smartrecruiters",
    boardToken: "Ubisoft2",
    website: "https://www.ubisoft.com",
  },
  {
    name: "US Bank",
    ats: "workday",
    boardToken: "usbank.wd1.myworkdayjobs.com|usbank|US_Bank_Careers",
    website: "https://www.usbank.com",
  },
  {
    name: "Wells Fargo",
    ats: "workday",
    boardToken: "wd1.myworkdaysite.com|wf|WellsFargoJobs",
    website: "https://www.wellsfargo.com",
  },
  {
    name: "Western Digital",
    ats: "smartrecruiters",
    boardToken: "WesternDigital",
    website: "https://www.westerndigital.com",
  },
  {
    name: "Workday",
    ats: "workday",
    boardToken: "workday.wd5.myworkdayjobs.com|workday|Workday",
    website: "https://www.workday.com",
  },
  {
    name: "Zoom",
    ats: "workday",
    boardToken: "zoom.wd5.myworkdayjobs.com|zoom|Zoom",
    website: "https://zoom.us",
  },
  // Staffing firms whose career portals publish their clients' roles through Bullhorn's public
  // jobs API, mostly contracts (verified live, September 2026).
  {
    name: "CEI",
    ats: "bullhorn",
    boardToken: "30|3vcpe1|cei.ai/jobs",
    website: "https://cei.ai",
    isStaffingAgency: true,
  },
  {
    name: "Prestige Staffing",
    ats: "bullhorn",
    boardToken: "30|SCQRD|jobs.prestigestaffing.com",
    website: "https://www.prestigestaffing.com",
    isStaffingAgency: true,
  },
  // Companies found by their board names on Greenhouse, Ashby and Lever, verified live
  // (September 2026).
  { name: "Adyen", ats: "greenhouse", boardToken: "adyen", website: "" },
  { name: "Affirm", ats: "greenhouse", boardToken: "affirm", website: "" },
  { name: "Airbyte", ats: "ashby", boardToken: "airbyte", website: "" },
  { name: "Airtable", ats: "greenhouse", boardToken: "airtable", website: "" },
  { name: "Airwallex", ats: "ashby", boardToken: "airwallex", website: "" },
  { name: "Alchemy", ats: "ashby", boardToken: "alchemy", website: "" },
  { name: "AngelList", ats: "lever", boardToken: "angellist", website: "" },
  { name: "Ashby", ats: "ashby", boardToken: "ashby", website: "" },
  { name: "Attentive", ats: "greenhouse", boardToken: "attentive", website: "" },
  { name: "Benchling", ats: "ashby", boardToken: "benchling", website: "" },
  { name: "Block", ats: "greenhouse", boardToken: "block", website: "" },
  { name: "Calendly", ats: "greenhouse", boardToken: "calendly", website: "" },
  { name: "Calm", ats: "greenhouse", boardToken: "calm", website: "" },
  { name: "Carta", ats: "greenhouse", boardToken: "carta", website: "" },
  { name: "Carvana", ats: "greenhouse", boardToken: "carvana", website: "" },
  { name: "Chime", ats: "greenhouse", boardToken: "chime", website: "" },
  { name: "ClickHouse", ats: "ashby", boardToken: "clickhouse", website: "" },
  { name: "Cockroach Labs", ats: "greenhouse", boardToken: "cockroachlabs", website: "" },
  { name: "Cohere", ats: "ashby", boardToken: "cohere", website: "" },
  { name: "Confluent", ats: "ashby", boardToken: "confluent", website: "" },
  { name: "Consensys", ats: "ashby", boardToken: "consensys", website: "" },
  { name: "Culture Amp", ats: "greenhouse", boardToken: "cultureamp", website: "" },
  { name: "Datadog", ats: "greenhouse", boardToken: "datadog", website: "" },
  { name: "Docker", ats: "ashby", boardToken: "docker", website: "" },
  { name: "Doximity", ats: "greenhouse", boardToken: "doximity", website: "" },
  { name: "Duolingo", ats: "greenhouse", boardToken: "duolingo", website: "" },
  { name: "Elastic", ats: "greenhouse", boardToken: "elastic", website: "" },
  { name: "ElevenLabs", ats: "ashby", boardToken: "elevenlabs", website: "" },
  { name: "Faire", ats: "greenhouse", boardToken: "faire", website: "" },
  { name: "Fireblocks", ats: "greenhouse", boardToken: "fireblocks", website: "" },
  { name: "Fivetran", ats: "greenhouse", boardToken: "fivetran", website: "" },
  { name: "Flatiron Health", ats: "greenhouse", boardToken: "flatironhealth", website: "" },
  { name: "Flexport", ats: "greenhouse", boardToken: "flexport", website: "" },
  { name: "Gemini", ats: "greenhouse", boardToken: "gemini", website: "" },
  { name: "Glossier", ats: "greenhouse", boardToken: "glossier", website: "" },
  { name: "Grafana Labs", ats: "greenhouse", boardToken: "grafanalabs", website: "" },
  { name: "Greenhouse", ats: "greenhouse", boardToken: "greenhouse", website: "" },
  { name: "Handshake", ats: "ashby", boardToken: "handshake", website: "" },
  { name: "Harvey", ats: "ashby", boardToken: "harvey", website: "" },
  { name: "Hex", ats: "ashby", boardToken: "hex", website: "" },
  { name: "Hims & Hers", ats: "ashby", boardToken: "hims-and-hers", website: "" },
  { name: "Instacart", ats: "greenhouse", boardToken: "instacart", website: "" },
  { name: "Intercom", ats: "greenhouse", boardToken: "intercom", website: "" },
  { name: "Justworks", ats: "greenhouse", boardToken: "justworks", website: "" },
  { name: "Komodo Health", ats: "greenhouse", boardToken: "komodohealth", website: "" },
  { name: "Lattice", ats: "greenhouse", boardToken: "lattice", website: "" },
  { name: "LaunchDarkly", ats: "greenhouse", boardToken: "launchdarkly", website: "" },
  { name: "Lucid Motors", ats: "greenhouse", boardToken: "lucidmotors", website: "" },
  { name: "Mercury", ats: "greenhouse", boardToken: "mercury", website: "" },
  { name: "Miro", ats: "ashby", boardToken: "miro", website: "" },
  { name: "Modal", ats: "ashby", boardToken: "modal", website: "" },
  { name: "Monzo", ats: "greenhouse", boardToken: "monzo", website: "" },
  { name: "Neo4j", ats: "greenhouse", boardToken: "neo4j", website: "" },
  { name: "Netlify", ats: "greenhouse", boardToken: "netlify", website: "" },
  { name: "Neuralink", ats: "greenhouse", boardToken: "neuralink", website: "" },
  { name: "New Relic", ats: "greenhouse", boardToken: "newrelic", website: "" },
  { name: "Nextdoor", ats: "greenhouse", boardToken: "nextdoor", website: "" },
  { name: "Nubank", ats: "ashby", boardToken: "nubank", website: "" },
  { name: "Nuro", ats: "greenhouse", boardToken: "nuro", website: "" },
  { name: "Okta", ats: "greenhouse", boardToken: "okta", website: "" },
  { name: "OpenSea", ats: "ashby", boardToken: "opensea", website: "" },
  { name: "Outreach", ats: "lever", boardToken: "outreach", website: "" },
  { name: "Oyster", ats: "ashby", boardToken: "oyster", website: "" },
  { name: "PagerDuty", ats: "greenhouse", boardToken: "pagerduty", website: "" },
  { name: "Peloton", ats: "greenhouse", boardToken: "peloton", website: "" },
  { name: "Perplexity", ats: "ashby", boardToken: "perplexity", website: "" },
  { name: "Redis", ats: "ashby", boardToken: "redis", website: "" },
  { name: "Render", ats: "ashby", boardToken: "render", website: "" },
  { name: "Replit", ats: "ashby", boardToken: "replit", website: "" },
  { name: "Ripple", ats: "greenhouse", boardToken: "ripple", website: "" },
  { name: "Ro", ats: "lever", boardToken: "ro", website: "" },
  { name: "Roblox", ats: "greenhouse", boardToken: "roblox", website: "" },
  { name: "Salesloft", ats: "greenhouse", boardToken: "salesloft", website: "" },
  { name: "Samsara", ats: "greenhouse", boardToken: "samsara", website: "" },
  { name: "Scale AI", ats: "greenhouse", boardToken: "scaleai", website: "" },
  { name: "Sentry", ats: "ashby", boardToken: "sentry", website: "" },
  { name: "Sierra", ats: "ashby", boardToken: "sierra", website: "" },
  { name: "SingleStore", ats: "greenhouse", boardToken: "singlestore", website: "" },
  { name: "Snowflake", ats: "ashby", boardToken: "snowflake", website: "" },
  { name: "SoFi", ats: "greenhouse", boardToken: "sofi", website: "" },
  { name: "SpaceX", ats: "greenhouse", boardToken: "spacex", website: "" },
  { name: "Spotify", ats: "lever", boardToken: "spotify", website: "" },
  { name: "Squarespace", ats: "greenhouse", boardToken: "squarespace", website: "" },
  { name: "Starburst", ats: "greenhouse", boardToken: "starburst", website: "" },
  { name: "Tailscale", ats: "greenhouse", boardToken: "tailscale", website: "" },
  { name: "Temporal", ats: "ashby", boardToken: "temporal", website: "" },
  { name: "Toast", ats: "greenhouse", boardToken: "toast", website: "" },
  { name: "Twilio", ats: "greenhouse", boardToken: "twilio", website: "" },
  { name: "Twitch", ats: "greenhouse", boardToken: "twitch", website: "" },
  { name: "Vanta", ats: "ashby", boardToken: "vanta", website: "" },
  { name: "Vercel", ats: "greenhouse", boardToken: "vercel", website: "" },
  { name: "Waymo", ats: "greenhouse", boardToken: "waymo", website: "" },
  { name: "Wealthsimple", ats: "ashby", boardToken: "wealthsimple", website: "" },
  { name: "Webflow", ats: "greenhouse", boardToken: "webflow", website: "" },
  { name: "Y Combinator", ats: "ashby", boardToken: "ycombinator", website: "" },
  { name: "Zapier", ats: "ashby", boardToken: "zapier", website: "" },
  { name: "ZipRecruiter", ats: "greenhouse", boardToken: "ziprecruiter", website: "" },
  { name: "Zocdoc", ats: "greenhouse", boardToken: "zocdoc", website: "" },
  { name: "Zoox", ats: "lever", boardToken: "zoox", website: "" },
];

const DEMO_COMPANY = {
  name: "Northwind Labs (demo)",
  slug: "northwind-labs-demo",
  ats: "greenhouse" as const,
  boardToken: "gettargetrole-demo",
  website: "https://example.com",
};

const DEMO_JOBS = [
  {
    externalId: "demo-1",
    title: "Senior Backend Engineer, Payments",
    department: "Engineering",
    location: "Remote — US",
    workplaceType: "remote" as const,
    salary: [170000, 215000] as const,
    description:
      "<p>Northwind Labs is building the payments platform for independent retailers.</p><h3>What you'll do</h3><ul><li>Design and operate Go and Python services on Kubernetes in AWS</li><li>Build event-driven pipelines with Kafka and PostgreSQL</li><li>Mentor engineers and lead design reviews</li></ul><h3>You have</h3><ul><li>5+ years building distributed systems</li><li>Experience with Terraform, gRPC and observability (Prometheus, Grafana)</li></ul>",
  },
  {
    externalId: "demo-2",
    title: "Full-Stack Engineer (React / Node.js)",
    department: "Engineering",
    location: "New York, NY (Hybrid)",
    workplaceType: "hybrid" as const,
    salary: [140000, 180000] as const,
    description:
      "<p>Join our product engineering team to ship customer-facing features end to end.</p><ul><li>Build UIs in React and TypeScript with Next.js</li><li>Own Node.js APIs backed by PostgreSQL and Redis</li><li>Write tests with Playwright and Jest; ship with CI/CD</li></ul>",
  },
  {
    externalId: "demo-3",
    title: "Machine Learning Engineer, Ranking",
    department: "AI",
    location: "San Francisco, CA",
    workplaceType: "onsite" as const,
    salary: [185000, 240000] as const,
    description:
      "<p>Improve search and recommendations for millions of shoppers.</p><ul><li>Train and deploy ranking models with PyTorch</li><li>Build feature pipelines with Apache Spark and Airflow</li><li>Run A/B testing and analyze results with statistics</li></ul>",
  },
  {
    externalId: "demo-4",
    title: "Product Manager, Growth",
    department: "Product",
    location: "Remote — US",
    workplaceType: "remote" as const,
    salary: [150000, 190000] as const,
    description:
      "<p>Own the activation funnel for our self-serve product.</p><ul><li>Define the roadmap with design, engineering and marketing</li><li>Run experiments and A/B testing; analyze with SQL and Looker</li><li>Communicate crisply with stakeholders</li></ul>",
  },
  {
    externalId: "demo-5",
    title: "Site Reliability Engineer",
    department: "Infrastructure",
    location: "Austin, TX",
    workplaceType: "onsite" as const,
    salary: [155000, 195000] as const,
    description:
      "<p>Keep our platform fast and available.</p><ul><li>Operate Kubernetes clusters with Terraform and Helm</li><li>Improve observability with Prometheus, Grafana and Datadog</li><li>Lead incident response and postmortems</li></ul>",
  },
];

function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|li|h\d)>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export async function seedCompanies(): Promise<number> {
  const db = getDb();
  const rows = DEFAULT_COMPANIES.map((company) => ({ ...company, slug: slugify(company.name) }));
  const inserted = await db
    .insert(companies)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: companies.id });
  return inserted.length;
}

/** Sample jobs so the product is explorable without live ingestion (local dev, demos, e2e). */
export async function seedDemoJobs(): Promise<number> {
  const db = getDb();
  const [company] = await db
    .insert(companies)
    .values({ ...DEMO_COMPANY, active: false, lastSyncStatus: "ok", lastSyncedAt: new Date() })
    .onConflictDoUpdate({ target: companies.slug, set: { name: DEMO_COMPANY.name } })
    .returning({ id: companies.id });
  if (!company) return 0;

  const now = Date.now();
  const values = DEMO_JOBS.map((job, index) => {
    const descriptionText = htmlToText(job.description);
    return {
      companyId: company.id,
      source: DEMO_COMPANY.ats,
      externalId: job.externalId,
      title: job.title,
      department: job.department,
      location: job.location,
      workplaceType: job.workplaceType,
      employmentType: "Full-time",
      descriptionHtml: job.description,
      descriptionText,
      applyUrl: `https://example.com/careers/${job.externalId}`,
      skills: findSkills(`${job.title}\n${descriptionText}`),
      salaryMin: job.salary[0],
      salaryMax: job.salary[1],
      salaryCurrency: "USD",
      salaryPeriod: "year" as const,
      postedAt: new Date(now - index * 3_600_000),
      firstSeenAt: new Date(now - index * 3_600_000),
      lastSeenAt: new Date(now),
      contentHash: createHash("sha256").update(job.description).digest("hex"),
    };
  });
  await db
    .insert(jobs)
    .values(values)
    .onConflictDoUpdate({
      target: [jobs.companyId, jobs.externalId],
      set: { lastSeenAt: sql`excluded.last_seen_at`, closedAt: null },
    });
  await db
    .update(companies)
    .set({ openJobCount: values.length })
    .where(sql`${companies.id} = ${company.id}`);
  return values.length;
}
