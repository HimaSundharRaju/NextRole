import { getSessionCookie } from "better-auth/cookies";
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Check,
  FileText,
  KanbanSquare,
  MailPlus,
  Radar,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { PLANS } from "@/lib/plans";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: Radar,
    title: "Real-time job radar",
    body: "We watch company career pages on Greenhouse, Lever, Ashby and SmartRecruiters and surface new roles within minutes — hours before they're reposted on job boards.",
  },
  {
    icon: Sparkles,
    title: "Claude resume studio",
    body: "Chat with Claude to write, rewrite and polish your resume while it updates live beside you. Export ATS-safe PDF or Word in one click.",
  },
  {
    icon: FileText,
    title: "Tailored apply kits",
    body: "For every job: a tailored resume, a specific cover letter and answers to application questions in your own voice — ready to review and submit.",
  },
  {
    icon: MailPlus,
    title: "Recruiter outreach",
    body: "Personal emails and LinkedIn notes to hiring managers, plus a follow-up, drafted from your real achievements. Send from your own inbox.",
  },
  {
    icon: KanbanSquare,
    title: "Application tracker",
    body: "Every application in one pipeline, with follow-up reminders and a receipt of exactly which resume and answers you sent.",
  },
  {
    icon: UserRoundCheck,
    title: "Concierge specialists",
    body: "Want help? A dedicated specialist can run your pipeline with you and apply to 25+ tailored roles a day, tracked live.",
  },
];

const STEPS = [
  {
    title: "Import your resume",
    body: "Upload a PDF or Word file, paste text, or start from scratch with Claude. Set the roles, locations and salary you want.",
  },
  {
    title: "Get matched instantly",
    body: "New jobs are scored against your profile the moment they appear. Strong matches trigger an alert.",
  },
  {
    title: "Apply with a tailored kit",
    body: "Review your tailored resume, cover letter and answers, submit, and let GetTargetRole track the follow-up.",
  },
];

export default async function LandingPage() {
  const signedIn = Boolean(getSessionCookie(await headers()));

  return (
    <div className="bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav
            className="hidden items-center gap-7 text-sm text-muted-foreground md:flex"
            aria-label="Main"
          >
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-foreground">
              How it works
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Link href="/dashboard" className={buttonVariants({ size: "sm" })}>
                Open dashboard
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Sign in
                </Link>
                <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-x-0 -top-40 h-[32rem] bg-[radial-gradient(ellipse_at_top,var(--primary-soft),transparent_65%)]"
            aria-hidden
          />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:pt-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden /> Resumes written with
                Claude
              </p>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                Land your next role <span className="text-primary">before the crowd applies.</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                GetTargetRole finds jobs the minute they go live, writes a tailored resume for each
                one, drafts your outreach and tracks every application — in one place.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={signedIn ? "/dashboard" : "/sign-up"}
                  className={buttonVariants({ size: "lg" })}
                >
                  {signedIn ? "Go to dashboard" : "Start free"}{" "}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a
                  href="#how-it-works"
                  className={buttonVariants({ variant: "secondary", size: "lg" })}
                >
                  See how it works
                </a>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">No credit card required.</p>
            </div>

            <div className="relative lg:mb-16" aria-hidden>
              <div className="rounded-2xl border border-border bg-card p-5 shadow-xl">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Senior Backend Engineer</p>
                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                    92% match
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Remote — US · $170k–$215k · posted 12 minutes ago
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {["Go", "Kubernetes", "PostgreSQL", "Kafka", "AWS"].map((skill) => (
                    <span
                      key={skill}
                      className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
                  {["Resume tailored", "Cover letter", "Outreach drafted"].map((item) => (
                    <div
                      key={item}
                      className="rounded-lg border border-border bg-background px-2 py-2"
                    >
                      <BadgeCheck className="mx-auto mb-1 h-4 w-4 text-primary" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div className="absolute -bottom-20 left-6 hidden w-64 rounded-xl border border-border bg-card p-4 shadow-lg sm:block">
                <p className="flex items-center gap-2 text-xs font-medium">
                  <BellRing className="h-4 w-4 text-primary" /> New match
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Staff Engineer, Platform · 88% match · just now
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-t border-border bg-card/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">
              Everything your search needs, working together
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Most tools do one piece: find jobs, write resumes, or track applications.
              GetTargetRole connects them, so each step makes the next one faster.
            </p>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-xl border border-border bg-card p-6 shadow-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="rounded-xl border border-border bg-card p-6 shadow-sm"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-10 flex items-start gap-4 rounded-xl border border-border bg-card p-6">
              <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
              <div>
                <h3 className="font-semibold">Honest by design</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  GetTargetRole never invents experience, titles or numbers. Every AI change is
                  versioned, and each application keeps a receipt of exactly what you sent. Your
                  data is encrypted in transit, never sold, and you can export or delete it any
                  time.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="border-t border-border bg-card/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-3xl font-semibold tracking-tight">Simple pricing</h2>
            <p className="mt-3 text-muted-foreground">
              Start free. Upgrade when your search picks up.
            </p>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {Object.values(PLANS).map((plan) => (
                <div
                  key={plan.id}
                  className={cn(
                    "flex flex-col rounded-xl border bg-card p-6 shadow-sm",
                    plan.id === "pro" ? "border-primary ring-1 ring-primary" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{plan.name}</h3>
                    {plan.id === "pro" ? (
                      <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
                        Most popular
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-3xl font-semibold">
                    ${plan.priceUsd}
                    <span className="text-sm font-normal text-muted-foreground">/month</span>
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{plan.tagline}</p>
                  <ul className="mt-5 flex-1 space-y-2 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/sign-up"
                    className={cn(
                      buttonVariants({ variant: plan.id === "pro" ? "primary" : "secondary" }),
                      "mt-6 w-full",
                    )}
                  >
                    {plan.priceUsd === 0 ? "Start free" : `Choose ${plan.name}`}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <Logo />
          <p>© {new Date().getFullYear()} GetTargetRole. Built with Claude.</p>
        </div>
      </footer>
    </div>
  );
}
