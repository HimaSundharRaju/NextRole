import { expect, test } from "@playwright/test";
import { signUpAndOnboard, uniqueEmail } from "./helpers";

test("candidate finds a job, builds an apply kit, applies and tracks it", async ({ page }) => {
  await signUpAndOnboard(page, "Asha Verma", uniqueEmail("asha"));
  await expect(page.getByRole("heading", { name: /Welcome back, Asha/ })).toBeVisible();

  await page.goto("/jobs");
  await page.getByRole("link", { name: "Senior Backend Engineer, Payments" }).click();
  await expect(page.getByRole("heading", { name: "Apply kit" })).toBeVisible();

  await page.getByRole("button", { name: "Analyze my fit with AI" }).click();
  await expect(page.getByText("AI assessment")).toBeVisible();

  await page.getByRole("button", { name: "Tailor my resume" }).click();
  await expect(page.getByText("What changed")).toBeVisible();

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
