import { expect, test } from "@playwright/test";
import { setPlan, signUpAndOnboard, sql, uniqueEmail } from "./helpers";

test("a specialist proposes, the client approves, the specialist submits and everyone sees it", async ({
  browser,
}) => {
  const clientEmail = uniqueEmail("riya");
  const specialistEmail = uniqueEmail("priya");
  const clientPage = await (await browser.newContext()).newPage();
  const specialistPage = await (await browser.newContext()).newPage();

  await signUpAndOnboard(clientPage, "Riya Client", clientEmail);
  await setPlan(clientEmail, "concierge");
  await signUpAndOnboard(specialistPage, "Priya Specialist", specialistEmail);
  await sql("update users set role = 'specialist' where email = $1", [specialistEmail]);
  const ids = await sql("select id, email from users where email = any($1)", [
    [clientEmail, specialistEmail],
  ]);
  const clientId = ids.rows.find((row) => row.email === clientEmail).id;
  const specialistId = ids.rows.find((row) => row.email === specialistEmail).id;
  await sql("insert into specialist_assignments (specialist_id, client_id) values ($1, $2)", [
    specialistId,
    clientId,
  ]);

  // The client sets up their job-search Gmail and gives consent.
  await clientPage.goto("/settings#concierge");
  await clientPage.getByLabel("Job-search Gmail").fill("riya.jobs.e2e@gmail.com");
  await clientPage
    .getByLabel(/I authorize my specialist to create accounts and apply for jobs/)
    .check();
  await clientPage.locator("#concierge").getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    clientPage.getByText("Saved. Your specialist will confirm they can open it."),
  ).toBeVisible();

  // The specialist proposes two jobs.
  await specialistPage.goto(`/specialist/${clientId}?tab=find`);
  const boxes = specialistPage.getByRole("checkbox", { name: /^Propose / });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await specialistPage.getByRole("button", { name: /Propose to client \(2\)/ }).click();
  await expect(specialistPage.getByText("Proposed 2 jobs to the client.")).toBeVisible();

  // The client approves one and skips the other.
  await clientPage.goto("/applications");
  const section = clientPage.getByRole("region", { name: "From your specialist" });
  const approveButtons = section.getByRole("button", { name: "Approve", exact: true });
  await approveButtons.first().click();
  // Wait for the approved job to leave the list before skipping the other one.
  await expect(approveButtons).toHaveCount(1);
  await section.getByRole("combobox").first().selectOption("pay");
  await section.getByRole("button", { name: "Skip", exact: true }).first().click();
  await expect(clientPage.getByRole("region", { name: "From your specialist" })).toHaveCount(0);

  // The specialist opens the approved application and marks it submitted.
  await specialistPage.goto("/specialist?column=approved");
  await specialistPage
    .getByRole("region", { name: "Approved — to submit column" })
    .getByRole("link")
    .first()
    .click();
  await specialistPage.getByRole("button", { name: "Mark submitted" }).click();
  await expect(specialistPage.getByText("Applied", { exact: true }).first()).toBeVisible();

  // The client sees the week's progress and who submitted.
  await clientPage.goto("/dashboard");
  await expect(clientPage.getByText(/applied to 1 of your 15 this week/)).toBeVisible();

  // An admin sees the same numbers on the team view.
  const adminEmail = uniqueEmail("ada");
  const adminPage = await (await browser.newContext()).newPage();
  await signUpAndOnboard(adminPage, "Ada Admin", adminEmail);
  await sql("update users set role = 'admin' where email = $1", [adminEmail]);
  await adminPage.goto("/admin?tab=specialists");
  await expect(adminPage.getByRole("row").filter({ hasText: clientEmail })).toContainText("1 / 15");
});
