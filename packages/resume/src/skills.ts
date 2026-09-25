/**
 * Curated vocabulary used for deterministic keyword matching (ATS checks and fast job scoring).
 * Each canonical term maps to the aliases recruiters and job posts commonly use for it.
 * Matching is case-insensitive and respects word boundaries.
 */
export const SKILL_ALIASES: Record<string, string[]> = {
  // Programming languages
  javascript: ["js", "ecmascript", "es6"],
  typescript: ["ts"],
  python: [],
  java: [],
  kotlin: [],
  swift: [],
  "objective-c": ["objective c"],
  go: ["golang"],
  rust: [],
  "c++": ["cpp"],
  "c#": ["csharp", "c sharp"],
  c: [],
  ruby: [],
  php: [],
  scala: [],
  elixir: [],
  haskell: [],
  r: [],
  matlab: [],
  sql: [],
  bash: ["shell scripting"],
  dart: [],
  lua: [],
  perl: [],
  solidity: [],

  // Frontend
  react: ["react.js", "reactjs"],
  "next.js": ["nextjs", "next js"],
  vue: ["vue.js", "vuejs"],
  nuxt: ["nuxt.js"],
  angular: ["angularjs"],
  svelte: ["sveltekit"],
  redux: [],
  html: ["html5"],
  css: ["css3"],
  sass: ["scss"],
  "tailwind css": ["tailwind", "tailwindcss"],
  webpack: [],
  vite: [],
  "react native": [],
  flutter: [],
  graphql: [],
  "web accessibility": ["accessibility", "a11y", "wcag"],

  // Backend & frameworks
  "node.js": ["node", "nodejs"],
  express: ["express.js"],
  nestjs: ["nest.js"],
  django: [],
  flask: [],
  fastapi: [],
  "spring boot": ["spring framework"],
  "ruby on rails": ["rails"],
  laravel: [],
  ".net": ["dotnet", "asp.net", ".net core"],
  grpc: [],
  "rest apis": ["restful", "rest api", "restful apis", "rest services"],
  microservices: ["microservice"],
  "event-driven architecture": ["event driven", "event-driven"],
  websockets: ["websocket"],

  // Data & ML
  postgresql: ["postgres", "psql"],
  mysql: [],
  mongodb: ["mongo"],
  redis: [],
  elasticsearch: ["elastic search", "opensearch"],
  cassandra: [],
  dynamodb: [],
  snowflake: [],
  bigquery: [],
  redshift: [],
  databricks: [],
  "apache spark": ["spark", "pyspark"],
  "apache kafka": ["kafka"],
  airflow: ["apache airflow"],
  dbt: [],
  etl: ["elt", "data pipelines", "data pipeline"],
  "data warehousing": ["data warehouse"],
  "data modeling": ["data modelling"],
  pandas: [],
  numpy: [],
  "scikit-learn": ["sklearn", "scikit learn"],
  tensorflow: [],
  pytorch: [],
  keras: [],
  "machine learning": ["ml"],
  "deep learning": [],
  "natural language processing": ["nlp"],
  "computer vision": ["opencv"],
  "large language models": ["llm", "llms"],
  "generative ai": ["genai", "gen ai"],
  "retrieval-augmented generation": ["rag"],
  "prompt engineering": [],
  mlops: [],
  statistics: ["statistical analysis"],
  "a/b testing": ["ab testing", "experimentation"],
  tableau: [],
  "power bi": ["powerbi"],
  looker: [],
  excel: ["microsoft excel"],

  // Cloud & DevOps
  aws: ["amazon web services"],
  "google cloud": ["gcp", "google cloud platform"],
  azure: ["microsoft azure"],
  docker: ["containers", "containerization"],
  kubernetes: ["k8s"],
  terraform: [],
  ansible: [],
  helm: [],
  "ci/cd": ["cicd", "continuous integration", "continuous delivery", "continuous deployment"],
  "github actions": [],
  jenkins: [],
  gitlab: ["gitlab ci"],
  linux: ["unix"],
  nginx: [],
  serverless: ["aws lambda", "lambda"],
  observability: ["monitoring"],
  prometheus: [],
  grafana: [],
  datadog: [],
  "site reliability engineering": ["sre"],
  "infrastructure as code": ["iac"],
  git: ["version control"],

  // Security
  cybersecurity: ["information security", "infosec"],
  "application security": ["appsec"],
  oauth: ["oauth2", "oauth 2.0", "openid connect", "oidc"],
  "identity and access management": ["iam"],
  "penetration testing": ["pentesting", "pen testing"],
  soc2: ["soc 2"],
  gdpr: [],
  hipaa: [],

  // Testing & quality
  "unit testing": ["unit tests"],
  "test automation": ["automated testing"],
  jest: [],
  vitest: [],
  cypress: [],
  playwright: [],
  selenium: [],
  pytest: [],
  "test-driven development": ["tdd"],

  // Product, design & process
  agile: [],
  scrum: [],
  kanban: [],
  jira: [],
  "product management": [],
  "project management": [],
  "program management": [],
  roadmapping: ["product roadmap", "roadmap"],
  "stakeholder management": ["stakeholder communication"],
  "user research": ["ux research"],
  "ux design": ["user experience", "ux"],
  "ui design": ["user interface design"],
  figma: [],
  "design systems": ["design system"],
  prototyping: [],
  "system design": ["distributed systems", "scalability"],
  "technical leadership": ["tech lead", "technical lead"],
  mentoring: ["mentorship", "coaching"],
  "cross-functional collaboration": ["cross-functional", "cross functional"],
  "people management": ["team leadership", "managing teams"],
  "strategic planning": [],

  // Business functions
  "digital marketing": [],
  seo: ["search engine optimization"],
  sem: ["search engine marketing", "ppc"],
  "content marketing": [],
  "growth marketing": ["growth hacking"],
  "email marketing": [],
  "marketing automation": ["hubspot", "marketo"],
  salesforce: ["sfdc"],
  crm: [],
  "account management": [],
  "business development": [],
  "customer success": [],
  "b2b sales": ["enterprise sales"],
  "financial modeling": ["financial modelling"],
  "financial analysis": ["fp&a"],
  accounting: ["gaap"],
  budgeting: ["forecasting"],
  "supply chain": ["logistics"],
  "business operations": [],
  "data analysis": ["data analytics", "analytics"],
  "business intelligence": ["bi"],
  "customer support": ["customer service"],
  recruiting: ["talent acquisition"],
  communication: ["communication skills"],
  "problem solving": ["problem-solving"],
};

export interface SkillTerm {
  canonical: string;
  patterns: RegExp[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary pattern that also works for terms like "c++", "c#" and ".net". */
function termPattern(term: string): RegExp {
  return new RegExp(`(?<![\\w.+#/-])${escapeRegExp(term)}(?![\\w+#/-]|\\.\\w)`, "i");
}

// Short language names collide with ordinary words ("go to market", "R&D", "Series C"), so they
// only count when written as a capitalised name inside a list or next to programming context.
const LIST_BEFORE = String.raw`(?:^|[,/(:;|]|\band\b|\bor\b)\s*`;
const CONTEXT_ONLY: Record<string, RegExp[]> = {
  c: [
    /\bC\s*(?:\/|and|&)\s*C\+\+/,
    /\bC programming\b/i,
    /\bANSI C\b/,
    new RegExp(`${LIST_BEFORE}C(?![+#&'.\\w-])`, "m"),
  ],
  r: [
    /\bR\s*(?:\/|and|&|,)\s*(?:Python|SQL|Stata|SAS|Julia)\b/,
    /\bR programming\b/i,
    /\bRStudio\b/i,
    new RegExp(`${LIST_BEFORE}R(?![&'.\\w-])`, "m"),
  ],
  go: [
    /\bGolang\b/i,
    new RegExp(`${LIST_BEFORE}Go(?![\\w'-])`, "m"),
    /\bGo\s*(?:[,/)]|and\b)/,
    /\b(?:in|with|using|written in) Go\b/,
    /\bGo (?:microservices|services|developer|engineer|programming|backend|code)\b/,
  ],
  // "excel at ..." is common job-post prose; only the capitalised product name counts.
  excel: [/\bMicrosoft Excel\b/i, /\bMS Excel\b/i, /(?<![.!?]\s)\bExcel\b(?! at\b| in\b)/],
};

export const SKILL_TERMS: SkillTerm[] = Object.entries(SKILL_ALIASES).map(
  ([canonical, aliases]) => ({
    canonical,
    patterns: CONTEXT_ONLY[canonical] ?? [canonical, ...aliases].map((term) => termPattern(term)),
  }),
);

/** Canonical skill terms that appear in `text`. */
export function findSkills(text: string): string[] {
  if (!text) return [];
  return SKILL_TERMS.filter((term) => term.patterns.some((pattern) => pattern.test(text))).map(
    (term) => term.canonical,
  );
}

// Canonical terms are lowercase for matching; these are their conventional spellings for display.
const SKILL_LABELS: Record<string, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  "c++": "C++",
  "c#": "C#",
  c: "C",
  r: "R",
  go: "Go",
  php: "PHP",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  "next.js": "Next.js",
  "node.js": "Node.js",
  vue: "Vue",
  nestjs: "NestJS",
  fastapi: "FastAPI",
  "ruby on rails": "Ruby on Rails",
  ".net": ".NET",
  grpc: "gRPC",
  graphql: "GraphQL",
  "rest apis": "REST APIs",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  dynamodb: "DynamoDB",
  bigquery: "BigQuery",
  dbt: "dbt",
  etl: "ETL",
  numpy: "NumPy",
  "scikit-learn": "scikit-learn",
  tensorflow: "TensorFlow",
  pytorch: "PyTorch",
  "natural language processing": "NLP",
  "large language models": "LLMs",
  "generative ai": "Generative AI",
  "retrieval-augmented generation": "RAG",
  mlops: "MLOps",
  "a/b testing": "A/B testing",
  "power bi": "Power BI",
  aws: "AWS",
  "google cloud": "Google Cloud",
  "ci/cd": "CI/CD",
  "github actions": "GitHub Actions",
  gitlab: "GitLab",
  "site reliability engineering": "SRE",
  oauth: "OAuth",
  "identity and access management": "IAM",
  soc2: "SOC 2",
  gdpr: "GDPR",
  hipaa: "HIPAA",
  "test-driven development": "TDD",
  "ux design": "UX design",
  "ui design": "UI design",
  seo: "SEO",
  sem: "SEM",
  crm: "CRM",
  "b2b sales": "B2B sales",
  "tailwind css": "Tailwind CSS",
  "react native": "React Native",
  "apache spark": "Apache Spark",
  "apache kafka": "Apache Kafka",
  "web accessibility": "Web accessibility",
  "objective-c": "Objective-C",
  ios: "iOS",
};

export function skillLabel(canonical: string): string {
  return SKILL_LABELS[canonical] ?? canonical.charAt(0).toUpperCase() + canonical.slice(1);
}
