import { expect, test } from "@playwright/test";
import { signUpAndOnboard, sql, uniqueEmail } from "./helpers";

const JOB = "Senior Backend Engineer, Payments";

/**
 * The demo job is shared with the other specs and with a retry of this one, so put it back as the
 * seed made it: unhidden and with no reports. (A report's ghost points are recomputed from the
 * reports that exist the next time anyone reports it.)
 */
async function restoreDemoJob() {
  await sql("delete from job_reports where job_id in (select id from jobs where title = $1)", [
    JOB,
  ]);
  await sql(
    "update jobs set hidden_at = null, hidden_by_user_id = null, hidden_reason = '' where title = $1",
    [JOB],
  );
}

test("a user writes in, an agent takes it and replies, the user answers, and the agent solves it", async ({
  browser,
}) => {
  const userEmail = uniqueEmail("riya");
  const agentEmail = uniqueEmail("ana");
  const userPage = await (await browser.newContext()).newPage();
  const agentPage = await (await browser.newContext()).newPage();

  await signUpAndOnboard(userPage, "Riya Client", userEmail);
  await signUpAndOnboard(agentPage, "Ana Agent", agentEmail);
  await sql("update users set role = 'support' where email = $1", [agentEmail]);

  // The user writes in.
  await userPage.goto("/support");
  await userPage.getByLabel("What is it about?").selectOption("account");
  await userPage.getByLabel("Subject").fill("Can't change my plan");
  await userPage
    .getByLabel("Message", { exact: true })
    .fill("The upgrade button does nothing for me.");
  await userPage.getByRole("button", { name: "Send", exact: true }).click();
  const confirmation = userPage.getByText(/We've got it — request #\d+/);
  await expect(confirmation).toBeVisible();
  const number = /#(\d+)/.exec((await confirmation.textContent()) ?? "")?.[1];
  if (!number) throw new Error("The confirmation didn't give a request number");

  // An agent finds it on the board, takes it and replies.
  await agentPage.goto("/care");
  await agentPage.getByRole("link", { name: `#${number} Can't change my plan` }).click();
  await agentPage.waitForURL(/\/care\/cases\/[0-9a-f-]{36}/);
  const caseUrl = agentPage.url();
  await agentPage.getByRole("button", { name: "Take it" }).click();
  await expect(agentPage.getByRole("button", { name: "Take it" })).toHaveCount(0);
  await agentPage.getByLabel("Reply or note").fill("Try the reset link we just emailed you.");
  await agentPage.getByRole("button", { name: "Send reply" }).click();
  await expect(agentPage.getByText("Waiting on user", { exact: true })).toBeVisible();

  // The user sees the reply, and answers.
  await userPage.goto("/support/requests");
  const row = userPage.getByRole("link", { name: `#${number} Can't change my plan` });
  await expect(row).toContainText("Waiting on you");
  await row.click();
  await expect(userPage.getByText("Try the reset link we just emailed you.")).toBeVisible();
  await userPage.getByLabel("Your reply").fill("That worked, thank you.");
  await userPage.getByRole("button", { name: "Send reply" }).click();
  await expect(userPage.getByText("With our team")).toBeVisible();

  // The agent solves it.
  await agentPage.goto(caseUrl);
  await agentPage.getByRole("button", { name: "Solve", exact: true }).click();
  await expect(agentPage.getByText("Solved", { exact: true })).toBeVisible();

  // From the request, the agent opens the account and changes the plan.
  await agentPage.getByRole("link", { name: /Open their account/ }).click();
  await agentPage.getByLabel("New plan").selectOption("plus");
  await agentPage.getByLabel("Reason: Change plan").fill("Upgraded after payment");
  await agentPage.getByRole("button", { name: "Change plan" }).click();
  await expect(agentPage.getByText("Plan changed.")).toBeVisible();
  const plan = await sql("select plan from users where email = $1", [userEmail]);
  expect(plan.rows[0].plan).toBe("plus");
});

test("an agent hides a reported job, and search stops showing it", async ({ browser }) => {
  const userPage = await (await browser.newContext()).newPage();
  const agentPage = await (await browser.newContext()).newPage();
  const agentEmail = uniqueEmail("ana");
  await restoreDemoJob();
  try {
    await signUpAndOnboard(userPage, "Riya Client", uniqueEmail("riya"));
    await signUpAndOnboard(agentPage, "Ana Agent", agentEmail);
    await sql("update users set role = 'support' where email = $1", [agentEmail]);

    // The user finds the job and reports it.
    await userPage.goto("/jobs");
    await userPage.getByRole("link", { name: JOB }).click();
    await userPage.getByRole("button", { name: /Report this job/ }).click();
    await userPage.getByLabel("It looks fake or misleading").check();
    await userPage.getByRole("button", { name: "Report", exact: true }).click();
    await expect(userPage.getByText(/Reports from several people hide a job/)).toBeVisible();

    // The agent hides it from the Reports tab.
    await agentPage.goto("/care?tab=reports");
    const card = agentPage.getByRole("listitem").filter({ hasText: JOB });
    await card.getByLabel("Why hide this job").fill("Looks like a ghost posting");
    await card.getByRole("button", { name: "Hide it" }).click();
    await expect(card).toHaveCount(0);

    // Search no longer shows it.
    await userPage.goto("/jobs");
    await expect(
      userPage.getByRole("heading", { name: "Jobs", exact: true, level: 1 }),
    ).toBeVisible();
    await expect(userPage.getByRole("link", { name: JOB })).toHaveCount(0);
  } finally {
    await restoreDemoJob();
  }
});
