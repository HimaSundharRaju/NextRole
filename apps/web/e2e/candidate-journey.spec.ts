import { expect, test } from "@playwright/test";
import { clickAiButton, setPlan, signUpAndOnboard, uniqueEmail } from "./helpers";

test("candidate finds a job, builds an apply kit, applies and tracks it", async ({ page }) => {
  const email = uniqueEmail("asha");
  await signUpAndOnboard(page, "Asha Verma", email);
  await expect(page.getByRole("heading", { name: /Welcome back, Asha/ })).toBeVisible();
  // Tailoring, cover letters and outreach come with paid plans.
  await setPlan(email, "pro");

  await page.goto("/jobs");
  await page.getByRole("link", { name: "Senior Backend Engineer, Payments" }).click();
  await expect(page.getByRole("heading", { name: "Apply kit" })).toBeVisible();

  await clickAiButton(page, "Analyze my fit with AI", "Analyze anyway");
  await expect(page.getByText("AI assessment")).toBeVisible();

  await clickAiButton(page, "Tailor my resume", "Tailor anyway");
  await expect(page.getByText("What changed")).toBeVisible();
  await expect(page.getByText("99 of 100 left this month")).toBeVisible();

  await page.getByRole("button", { name: "Write cover letter" }).click();
  await expect(page.getByLabel("Cover letter")).toContainText("Dear Hiring Team");

  await page
    .getByLabel("Application questions")
    .fill("Why do you want to work here?\nDo you require visa sponsorship?");
  await page.getByRole("button", { name: "Answer with AI" }).click();
  await expect(page.getByText("Why do you want to work here?", { exact: true })).toBeVisible();

  await page.getByPlaceholder("Name (optional)").fill("Jordan Lee");
  await page.getByRole("button", { name: "Draft email & LinkedIn note" }).click();
  await expect(page.getByText("LinkedIn note", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "I've applied" }).click();
  await expect(page.getByText("receipt saved")).toBeVisible();

  await page.goto("/applications");
  const applied = page.getByRole("region", { name: "Applied column" });
  await expect(applied.getByText("Senior Backend Engineer, Payments")).toBeVisible();

  await applied.getByRole("link", { name: "Senior Backend Engineer, Payments" }).click();
  await expect(page.getByText("What you sent")).toBeVisible();

  await page.goto("/outreach");
  await expect(page.getByText("LinkedIn connection note").first()).toBeVisible();
});

test("resume studio chat edits the resume and exports files", async ({ page }) => {
  await signUpAndOnboard(page, "Riya Patel", uniqueEmail("riya"));
  await page.goto("/resumes");
  await page.getByRole("link", { name: /Riya Patel — resume/ }).click();

  await page.getByLabel("Message", { exact: true }).fill("Rewrite my summary to be punchier");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Rewrote the summary")).toBeVisible();

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("button", { name: "Restore" }).first()).toBeVisible();

  await page.getByRole("tab", { name: "ATS check" }).click();
  await expect(page.getByText("ATS readiness")).toBeVisible();

  for (const [name, extension] of [
    ["PDF", ".pdf"],
    ["Word", ".docx"],
  ] as const) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name, exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`Riya-Patel-resume${extension}`);
  }
});

test("users can export their data", async ({ page }) => {
  await signUpAndOnboard(page, "Data Owner", uniqueEmail("data"));
  const response = await page.request.get("/api/account/export");
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.user.name).toBe("Data Owner");
  expect(data.resumes).toHaveLength(1);
});

test("a job found elsewhere gets a kit from its pasted description", async ({ page }) => {
  const email = uniqueEmail("pasted");
  await signUpAndOnboard(page, "Priya Nair", email);
  await setPlan(email, "plus");

  await page.goto("/applications");
  await page.getByRole("link", { name: "Tailor to a job description" }).click();
  await page.getByLabel("Company").fill("Initech");
  await page.getByLabel("Job title").fill("Platform Engineer");
  await page
    .getByLabel("Job description")
    .fill(
      "Initech is hiring a Platform Engineer to run our Kubernetes clusters on AWS. " +
        "You will build internal tooling in Go and Python, own our Terraform modules, and " +
        "improve reliability with better observability. You have 4+ years of backend or " +
        "infrastructure experience and enjoy mentoring teammates.",
    );
  await page.getByRole("button", { name: "Continue to the apply kit" }).click();
  await page.waitForURL(/\/applications\/[0-9a-f-]+$/);

  await page.getByRole("button", { name: "Tailor my resume" }).click();
  await expect(page.getByText("What changed")).toBeVisible();
  await expect(page.getByText("39 of 40 left this month")).toBeVisible();
  await page.getByRole("button", { name: "Write cover letter" }).click();
  await expect(page.getByLabel("Cover letter")).toContainText("Initech");
});

test("the free plan shows the job board and offers tailoring as an upgrade", async ({ page }) => {
  await signUpAndOnboard(page, "Sam Lee", uniqueEmail("free"));
  await page.goto("/jobs");
  await page.getByRole("link", { name: "Senior Backend Engineer, Payments" }).click();
  await expect(page.getByRole("button", { name: "Tailor my resume" })).toBeDisabled();
  await expect(
    page.getByText("Tailored resumes aren't included in the Free plan.", { exact: false }),
  ).toBeVisible();

  await page.goto("/settings#plan");
  await expect(page.getByRole("heading", { name: "Plan & usage" })).toBeVisible();
  await expect(page.getByText("Auto-prepare is part of Pro", { exact: false })).toBeVisible();
});
