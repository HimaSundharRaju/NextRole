/** Trimmed but structurally faithful responses from each ATS public API. */

export const greenhouseResponse = {
  jobs: [
    {
      id: 4012345,
      title: "Senior Software Engineer, Payments ",
      updated_at: "2026-09-20T12:00:00-04:00",
      first_published: "2026-09-18T09:00:00-04:00",
      absolute_url: "https://job-boards.greenhouse.io/acme/jobs/4012345",
      location: { name: "San Francisco, CA or Remote (US)" },
      departments: [{ name: "Engineering" }],
      offices: [{ name: "San Francisco" }],
      metadata: [],
      content:
        "&lt;p&gt;We build payments in &lt;strong&gt;Go&lt;/strong&gt; and Kubernetes.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;5+ years with PostgreSQL&lt;/li&gt;&lt;/ul&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;p&gt;Salary: $180,000 – $220,000 per year&lt;/p&gt;",
    },
    {
      id: 4012346,
      title: "Data Analyst",
      updated_at: "2026-09-21T12:00:00-04:00",
      absolute_url: "https://job-boards.greenhouse.io/acme/jobs/4012346",
      location: { name: "New York, NY" },
      departments: [{ name: "Analytics" }],
      content: "&lt;p&gt;SQL, Tableau and statistics.&lt;/p&gt;",
      pay_input_ranges: [
        { min_cents: 9500000, max_cents: 12000000, currency_type: "USD", title: "NYC" },
      ],
    },
  ],
};

export const leverResponse = [
  {
    id: "5f1c-lever-1",
    text: "Frontend Engineer",
    createdAt: 1_758_000_000_000,
    hostedUrl: "https://jobs.lever.co/acme/5f1c-lever-1",
    applyUrl: "https://jobs.lever.co/acme/5f1c-lever-1/apply",
    description: "<div>Build delightful UIs with React and TypeScript.</div>",
    lists: [{ text: "Requirements", content: "<li>3+ years of React</li><li>CSS expertise</li>" }],
    additional: "<div>We offer great benefits.</div>",
    workplaceType: "hybrid",
    categories: {
      team: "Web",
      department: "Engineering",
      location: "London",
      commitment: "Full-time",
      allLocations: ["London"],
    },
    salaryRange: { min: 70000, max: 90000, currency: "GBP", interval: "per-year-salary" },
  },
];

export const ashbyResponse = {
  jobs: [
    {
      id: "ashby-uuid-1",
      title: "Machine Learning Engineer",
      department: "Research",
      team: "Applied ML",
      employmentType: "FullTime",
      location: "Remote - US",
      secondaryLocations: [{ location: "Seattle, WA" }],
      publishedAt: "2026-09-22T00:00:00.000Z",
      isListed: true,
      isRemote: true,
      workplaceType: "Remote",
      jobUrl: "https://jobs.ashbyhq.com/acme/ashby-uuid-1",
      applyUrl: "https://jobs.ashbyhq.com/acme/ashby-uuid-1/application",
      descriptionHtml: "<p>Train models with PyTorch and deploy on AWS.</p>",
      compensation: {
        summaryComponents: [
          {
            compensationType: "Salary",
            interval: "1 YEAR",
            currencyCode: "USD",
            minValue: 200000,
            maxValue: 260000,
          },
          { compensationType: "EquityPercentage", interval: "NONE", minValue: 0.1, maxValue: 0.2 },
        ],
      },
    },
    {
      id: "ashby-uuid-2",
      title: "Unlisted role",
      isListed: false,
      jobUrl: "https://jobs.ashbyhq.com/acme/ashby-uuid-2",
    },
  ],
};

export const smartRecruitersList = {
  offset: 0,
  limit: 100,
  totalFound: 1,
  content: [
    {
      id: "744000012345",
      name: "Product Designer",
      releasedDate: "2026-09-19T10:00:00.000Z",
      location: {
        city: "Austin",
        region: "TX",
        country: "us",
        remote: false,
        fullLocation: "Austin, TX, United States",
      },
      department: { label: "Design" },
      typeOfEmployment: { label: "Full-time" },
    },
  ],
};

export const smartRecruitersDetail = {
  id: "744000012345",
  name: "Product Designer",
  postingUrl: "https://jobs.smartrecruiters.com/Acme/744000012345",
  applyUrl: "https://jobs.smartrecruiters.com/Acme/744000012345?apply=true",
  jobAd: {
    sections: {
      jobDescription: {
        title: "Job Description",
        text: "<p>Design flows in Figma; hybrid in Austin.</p>",
      },
      qualifications: { title: "Qualifications", text: "<ul><li>Design systems</li></ul>" },
    },
  },
};

/** A fetch stub that serves fixtures by URL prefix and records requests. */
export function fakeFetch(routes: Record<string, unknown>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => url.startsWith(prefix));
    if (!match) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[match]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return Object.assign(impl as typeof fetch, { calls });
}
