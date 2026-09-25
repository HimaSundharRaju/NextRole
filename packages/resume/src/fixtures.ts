import type { Resume } from "./schema";

/** Realistic sample used by tests, the mock AI provider and the demo seed. */
export const SAMPLE_RESUME: Resume = {
  basics: {
    name: "Asha Verma",
    headline: "Senior Backend Engineer",
    email: "asha.verma@example.com",
    phone: "+1 (415) 555-0142",
    location: "San Francisco, CA",
    links: [
      { label: "LinkedIn", url: "https://www.linkedin.com/in/ashaverma" },
      { label: "GitHub", url: "https://github.com/ashaverma" },
    ],
  },
  summary:
    "Backend engineer with 7 years of experience building high-throughput APIs and data platforms in Python and Go. Led the migration of a monolith to event-driven microservices on AWS that cut infrastructure costs by 32%. Comfortable owning systems end to end, from design reviews to on-call.",
  experience: [
    {
      company: "Brightline Payments",
      title: "Senior Software Engineer",
      location: "San Francisco, CA",
      startDate: "Mar 2021",
      endDate: "Present",
      highlights: [
        "Led a team of 5 to split a Django monolith into 14 Python and Go microservices on AWS EKS, reducing p95 latency from 820ms to 210ms.",
        "Designed an event-driven ledger on Apache Kafka and PostgreSQL processing 45M transactions per day with zero data loss incidents.",
        "Cut monthly AWS spend by 32% ($410K/year) through right-sizing, Graviton instances and Redis caching.",
        "Mentored 6 engineers and introduced design reviews adopted across 4 teams.",
      ],
    },
    {
      company: "Cartwheel Logistics",
      title: "Software Engineer",
      location: "Austin, TX",
      startDate: "Jun 2018",
      endDate: "Feb 2021",
      highlights: [
        "Built REST APIs in FastAPI serving 3,000 requests per second for real-time shipment tracking.",
        "Automated CI/CD with GitHub Actions and Terraform, taking deploys from weekly to 20+ per day.",
        "Responsible for maintaining legacy cron jobs.",
      ],
    },
  ],
  education: [
    {
      institution: "University of Texas at Austin",
      degree: "B.S.",
      field: "Computer Science",
      location: "Austin, TX",
      startDate: "2014",
      endDate: "2018",
      highlights: ["GPA 3.8/4.0"],
    },
  ],
  skills: [
    { name: "Languages", items: ["Python", "Go", "TypeScript", "SQL"] },
    {
      name: "Platforms",
      items: ["AWS", "Kubernetes", "Docker", "Terraform", "PostgreSQL", "Redis"],
    },
    { name: "Practices", items: ["Microservices", "Event-driven architecture", "System design"] },
  ],
  projects: [
    {
      name: "pg-shard-kit",
      link: "https://github.com/ashaverma/pg-shard-kit",
      description: "Open-source toolkit for online resharding of PostgreSQL tables.",
      highlights: ["800+ GitHub stars; used in production by 3 fintech companies."],
      technologies: ["Go", "PostgreSQL"],
    },
  ],
  certifications: [
    {
      name: "AWS Certified Solutions Architect – Associate",
      issuer: "Amazon Web Services",
      date: "2022",
    },
  ],
  customSections: [],
};

export const SAMPLE_JOB_DESCRIPTION = `We're hiring a Senior Backend Engineer to scale our payments platform.
You'll design distributed systems in Go and Python, run services on Kubernetes in AWS,
and build event-driven pipelines with Kafka. Experience with PostgreSQL, gRPC, Terraform
and observability tooling (Prometheus, Grafana) is a plus. You should excel at mentoring
and cross-functional collaboration.`;
