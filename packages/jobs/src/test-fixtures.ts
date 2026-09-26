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

/** Workday (POST .../jobs and GET .../job/<path>), shaped like Barclays' and NVIDIA's sites. */
export const workdayList = {
  total: 2,
  jobPostings: [
    {
      title: "Securitized Products CRE Attorney",
      externalPath: "/job/New-York-745-7th-Avenue/Securitized-Products-CRE-Attorney_JR-0000104532",
      timeType: "Full time",
      locationsText: "New York, 745 7th Avenue",
      postedOn: "Posted Yesterday",
      bulletFields: ["JR-0000104532"],
    },
    {
      title: "Senior Systems Software Engineer - GPU Performance at Scale ",
      externalPath: "/job/US-CA-Santa-Clara/Senior-Performance-Engineer_JR1996987",
      locationsText: "5 Locations",
      postedOn: "Posted 30+ Days Ago",
      bulletFields: ["JR1996987"],
    },
  ],
  facets: [],
};

export const workdayDetail = {
  jobPostingInfo: {
    id: "078c730834101001267e6a1048b10000",
    title: "Senior Systems Software Engineer - GPU Performance at Scale",
    jobDescription:
      "<p>We are looking for engineers who love <b>CUDA</b> and C++.</p><p>The base salary range is $184,000 - $287,500 USD per year.</p>",
    location: "US, CA, Santa Clara",
    additionalLocations: ["US, WA, Redmond", "US, TX, Austin"],
    startDate: "2026-08-20",
    timeType: "Full time",
    externalUrl:
      "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Performance-Engineer_JR1996987",
    jobRequisitionLocation: {
      descriptor: "US, CA, Santa Clara",
      country: { descriptor: "United States of America", alpha2Code: "US" },
    },
  },
};

/** Oracle Recruiting Cloud, shaped like JPMorgan Chase's site. */
export const oracleList = {
  items: [
    {
      TotalJobsCount: 2,
      requisitionList: [
        {
          Id: "210743443",
          Title: "Director of Software Engineering - Data & Wealth Management",
          PostedDate: "2026-09-26",
          PrimaryLocation: "Bengaluru, Karnataka, India",
          PrimaryLocationCountry: "IN",
          WorkplaceType: "",
          JobFamily: "Software Engineering",
          secondaryLocations: [{ Name: "Mumbai, Maharashtra, India", CountryCode: "IN" }],
        },
        {
          Id: "210700001",
          Title: "Software Engineer III - Java",
          PostedDate: "2026-09-25",
          PrimaryLocation: "Plano, TX, United States",
          PrimaryLocationCountry: "US",
          WorkplaceType: "Hybrid",
          JobFamily: "Software Engineering",
          secondaryLocations: [],
        },
      ],
    },
  ],
};

export const oracleDetail = {
  items: [
    {
      Id: "210700001",
      ExternalDescriptionStr: "<p>Build trading platforms in Java and Spring.</p>",
      ExternalResponsibilitiesStr: "<ul><li>Own services on AWS</li></ul>",
      ExternalQualificationsStr: "<ul><li>3+ years of Java</li></ul>",
      JobSchedule: "Full time",
      ExternalPostedStartDate: "2026-09-25T07:14:12+00:00",
      WorkplaceType: "Hybrid",
    },
  ],
};

/** Eightfold's older API (/api/apply/v2), shaped like Netflix's site. */
export const eightfoldList = {
  count: 2,
  positions: [
    {
      id: 790298014263,
      name: "AI Engineer 6 - AI Foundation & Tooling, Ads Platform",
      location: "Remote, United States",
      locations: ["Remote, United States"],
      department: "Data & Insights",
      t_create: 1721692800,
      work_location_option: "onsite",
      canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790298014263",
      job_description: "",
    },
    {
      id: 790298014264,
      name: "Software Engineer (L5), Playback",
      location: "Los Gatos, California, United States of America",
      locations: ["Los Gatos, California, United States of America"],
      department: "Engineering",
      t_create: 1722000000,
      work_location_option: "hybrid",
      canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790298014264",
      job_description: "",
    },
  ],
};

export const eightfoldDetail = {
  id: 790298014263,
  job_description:
    "<p>At Netflix, our mission is to entertain the world.</p><p>The overall market range for this role is typically $190,000 - $920,000.</p>",
  canonicalPositionUrl:
    "https://explore.jobs.netflix.net/careers/job/790298014263?microsite=netflix.com",
};

/** Eightfold's newer API (/api/pcsx), shaped like Microsoft's site. */
export const pcsxList = {
  status: 200,
  error: null,
  data: {
    count: 1,
    positions: [
      {
        id: 1970393556998576,
        displayJobId: "200055749",
        name: "Director of Product Marketing, Monetization",
        locations: [
          "United States, Washington, Redmond",
          "United States, California, Mountain View",
        ],
        standardizedLocations: ["Redmond, WA, US", "Mountain View, CA, US"],
        postedTs: 1790454929,
        department: "Product Marketing",
        creationTs: 1789415791,
        workLocationOption: "onsite",
        positionUrl: "/careers/job/1970393556998576",
      },
    ],
  },
};

export const pcsxDetail = {
  status: 200,
  error: null,
  data: {
    id: 1970393556998576,
    jobDescription:
      "<b>Overview</b><p>Lead product marketing for monetization.</p><p>USD $139,900 - $274,800 per year.</p>",
    publicUrl: "https://apply.careers.microsoft.com/careers/job/1970393556998576",
    efcustomTextEmploymentType: ["Full-Time"],
  },
};
