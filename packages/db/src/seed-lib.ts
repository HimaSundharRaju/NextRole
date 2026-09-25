import { createHash } from "node:crypto";
import { findSkills } from "@nextrole/resume/skills";
import { sql } from "drizzle-orm";
import { getDb } from "./client";
import { companies, jobs, type AtsProvider } from "./schema";
import { slugify } from "./slug";

/**
 * Public job boards NextRole ingests out of the box. Admins can add more from the admin console;
 * a wrong board token only marks that company's sync as failed.
 */
export const DEFAULT_COMPANIES: Array<{
  name: string;
  ats: AtsProvider;
  boardToken: string;
  website: string;
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
];

const DEMO_COMPANY = {
  name: "Northwind Labs (demo)",
  slug: "northwind-labs-demo",
  ats: "greenhouse" as const,
  boardToken: "nextrole-demo",
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
