/*
 * Inputs for the model quality check. Resumes are synthetic (fictional people, companies and
 * example.com addresses); job descriptions are real public postings, trimmed.
 */
import { readFileSync } from "node:fs";
import { emptyResume, type Resume } from "@gettargetrole/resume/schema";
import type { CandidateProfile, JobContext } from "../src/types";

const readJson = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;

const seniorBackendJson = readJson<Resume>("senior-backend.json");
const jobsJson = readJson<Array<EvalJob & { key: string }>>("jobs.json");

export interface Persona {
  id: string;
  resume: Resume;
  profile: CandidateProfile;
}

const baseProfile: CandidateProfile = {
  targetTitles: [],
  workAuthorization: "US citizen",
  needsSponsorship: false,
  minSalary: null,
  salaryCurrency: "USD",
  voiceNotes: "",
  phone: "",
  linkedinUrl: "",
};

const newGrad: Resume = {
  ...emptyResume(),
  basics: {
    name: "Diego Alvarez",
    headline: "Software Engineer",
    email: "diego.alvarez@example.com",
    phone: "+1 512 555 0177",
    location: "Austin, TX",
    links: [{ label: "GitHub", url: "https://github.com/diego-alvarez-example" }],
  },
  summary:
    "Computer science graduate who has shipped production code in two internships. Enjoys backend services, APIs and making tests fast.",
  experience: [
    {
      company: "Tidewater Logistics",
      title: "Software Engineering Intern",
      location: "Austin, TX",
      startDate: "May 2025",
      endDate: "Aug 2025",
      highlights: [
        "Built a shipment-status API in Python and FastAPI used by 3 internal teams",
        "Cut the integration test suite from 14 to 6 minutes by parallelizing database fixtures",
        "Added structured logging and dashboards for the dispatch service",
      ],
    },
    {
      company: "Campus IT Services",
      title: "Student Developer",
      location: "Austin, TX",
      startDate: "Sep 2023",
      endDate: "May 2025",
      highlights: [
        "Maintained a Django app for room bookings serving 20,000 students",
        "Migrated the app's jobs from cron to Celery with retries and alerts",
      ],
    },
  ],
  education: [
    {
      institution: "Texas State University",
      degree: "B.S.",
      field: "Computer Science",
      location: "San Marcos, TX",
      startDate: "2021",
      endDate: "2025",
      highlights: ["GPA 3.7", "Coursework: distributed systems, databases, operating systems"],
    },
  ],
  skills: [
    { name: "Languages", items: ["Python", "Java", "TypeScript", "SQL"] },
    { name: "Tools", items: ["FastAPI", "Django", "PostgreSQL", "Docker", "Git", "Celery"] },
  ],
  projects: [
    {
      name: "Transit Tracker",
      link: "https://github.com/diego-alvarez-example/transit-tracker",
      description: "Real-time bus arrival predictions for Austin.",
      highlights: ["Ingests GTFS feeds every 30 seconds", "Serves 500 weekly users"],
      technologies: ["TypeScript", "Node.js", "Redis"],
    },
  ],
};

const dataAnalyst: Resume = {
  ...emptyResume(),
  basics: {
    name: "Mei Chen",
    headline: "Data Analyst",
    email: "mei.chen@example.com",
    phone: "+1 206 555 0133",
    location: "Seattle, WA",
    links: [],
  },
  summary:
    "Data analyst with 4 years turning product and revenue data into decisions. Strong in SQL, experiment analysis and dashboards that executives actually use.",
  experience: [
    {
      company: "Evergreen Commerce",
      title: "Senior Data Analyst",
      location: "Seattle, WA",
      startDate: "Feb 2023",
      endDate: "Present",
      highlights: [
        "Own the checkout funnel metrics and weekly business review for a $120M marketplace",
        "Designed and analyzed 30+ A/B tests; one pricing test lifted conversion 6%",
        "Built dbt models that replaced 40 ad-hoc queries and cut dashboard load times in half",
      ],
    },
    {
      company: "Cascade Health",
      title: "Data Analyst",
      location: "Seattle, WA",
      startDate: "Jul 2021",
      endDate: "Jan 2023",
      highlights: [
        "Automated monthly claims reporting in Python, saving 20 analyst hours a month",
        "Built Tableau dashboards for care-team staffing used by 12 clinics",
      ],
    },
  ],
  education: [
    {
      institution: "University of Washington",
      degree: "B.S.",
      field: "Statistics",
      location: "Seattle, WA",
      startDate: "2017",
      endDate: "2021",
      highlights: [],
    },
  ],
  skills: [
    { name: "Analysis", items: ["SQL", "Python", "pandas", "A/B testing", "Statistics"] },
    { name: "Tools", items: ["dbt", "Snowflake", "Tableau", "Looker", "Airflow"] },
  ],
};

const productManager: Resume = {
  ...emptyResume(),
  basics: {
    name: "Samira Okafor",
    headline: "Product Manager",
    email: "samira.okafor@example.com",
    phone: "+1 646 555 0190",
    location: "New York, NY",
    links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/samira-okafor-example" }],
  },
  summary:
    "Product manager with 6 years in fintech and B2B SaaS. Leads discovery, writes crisp specs and ships with engineering and design.",
  experience: [
    {
      company: "Ledgerly",
      title: "Senior Product Manager, Payments",
      location: "New York, NY",
      startDate: "Mar 2022",
      endDate: "Present",
      highlights: [
        "Led the merchant onboarding redesign that cut time-to-first-payment from 5 days to 1",
        "Launched instant payouts to 8,000 merchants with engineering, risk and compliance",
        "Defined the payments roadmap and OKRs for a team of 9 engineers and 2 designers",
      ],
    },
    {
      company: "Brightdesk",
      title: "Product Manager",
      location: "New York, NY",
      startDate: "Jun 2019",
      endDate: "Feb 2022",
      highlights: [
        "Shipped role-based permissions that unblocked 3 enterprise deals",
        "Ran 40 customer interviews to reframe the reporting product; adoption grew 2x",
      ],
    },
  ],
  education: [
    {
      institution: "Rutgers University",
      degree: "B.A.",
      field: "Economics",
      location: "New Brunswick, NJ",
      startDate: "2013",
      endDate: "2017",
      highlights: [],
    },
  ],
  skills: [
    { name: "Product", items: ["Discovery", "Roadmapping", "Experimentation", "SQL", "Figma"] },
    { name: "Domains", items: ["Payments", "Onboarding", "Compliance", "B2B SaaS"] },
  ],
};

export const PERSONAS: Persona[] = [
  {
    id: "senior-backend",
    resume: seniorBackendJson as Resume,
    profile: { ...baseProfile, targetTitles: ["Senior Software Engineer", "Backend Engineer"] },
  },
  {
    id: "new-grad",
    resume: newGrad,
    profile: {
      ...baseProfile,
      targetTitles: ["Software Engineer"],
      workAuthorization: "F-1 student on OPT; will need H-1B sponsorship",
      needsSponsorship: true,
    },
  },
  {
    id: "data-analyst",
    resume: dataAnalyst,
    profile: { ...baseProfile, targetTitles: ["Data Analyst", "Analytics Engineer"] },
  },
  {
    id: "product-manager",
    resume: productManager,
    profile: { ...baseProfile, targetTitles: ["Product Manager"] },
  },
];

export interface EvalJob extends JobContext {
  key: string;
  url: string;
}

export const JOBS: EvalJob[] = jobsJson.map((job) => ({
  key: job.key,
  url: job.url,
  title: job.title,
  company: job.company,
  location: job.location,
  description: job.description,
}));

/** Every persona against every job: good fits and mismatches, to test honesty as well. */
export const PAIRS = PERSONAS.flatMap((persona) => JOBS.map((job) => ({ persona, job })));

export const QUESTIONS = [
  "Why do you want to work here?",
  "Describe a project you're proud of and your role in it.",
  "Will you now or in the future require visa sponsorship?",
];

export interface StudioCase {
  message: string;
  /** Which sections the edit may change; everything else must stay identical. */
  sections: Array<keyof Resume>;
  /** Extra check on the edited resume, when the request is specific. */
  expect?: (after: Resume) => boolean;
}

export const STUDIO_CASES: StudioCase[] = [
  { message: "Rewrite my summary to be punchier, under 40 words.", sections: ["summary"] },
  {
    message: "Add Terraform to my skills.",
    sections: ["skills"],
    expect: (after) =>
      after.skills.some((group) => group.items.some((item) => /terraform/i.test(item))),
  },
  {
    message: "Change my headline to Staff Software Engineer.",
    sections: ["basics"],
    expect: (after) => after.basics.headline === "Staff Software Engineer",
  },
  {
    message: "Tighten the bullets in my most recent role; keep every fact.",
    sections: ["experience"],
  },
  {
    message: "Remove my oldest role.",
    sections: ["experience"],
  },
];
