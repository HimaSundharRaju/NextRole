import { expect, test } from "@playwright/test";
import { signUp, signUpAndOnboard, sql, uniqueEmail } from "./helpers";

test("anonymous visitors are sent to sign in with a safe return path", async ({ page }) => {
  await page.goto("/applications");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapplications/);
});

test("pages carry a nonce-based Content-Security-Policy and hardening headers", async ({
  request,
}) => {
  const response = await request.get("/");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("cross-site POSTs to API routes are rejected", async ({ page }) => {
  await signUp(page, "Csrf Target", uniqueEmail("csrf"));
  const response = await page.request.post("/api/resumes/import", {
    headers: { origin: "https://evil.example" },
    multipart: { text: "x".repeat(100) },
  });
  expect(response.status()).toBe(403);
});

test("resume uploads are checked by content, not file name", async ({ page }) => {
  await signUp(page, "Upload Tester", uniqueEmail("upload"));
  const response = await page.request.post("/api/resumes/import", {
    headers: { origin: new URL(page.url()).origin },
    multipart: {
      file: {
        name: "resume.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("<script>alert(1)</script>"),
      },
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain("PDF or Word");
});

test("users cannot read each other's resumes", async ({ browser }) => {
  const owner = await browser.newPage();
  await signUpAndOnboard(owner, "Owner", uniqueEmail("owner"));
  await owner.goto("/resumes");
  await owner.getByRole("link", { name: /Owner — resume/ }).click();
  await owner.waitForURL(/\/resumes\/[0-9a-f-]{36}$/);
  const resumeUrl = owner.url();
  const resumeId = resumeUrl.split("/").pop()!;

  const intruder = await browser.newPage();
  await signUpAndOnboard(intruder, "Intruder", uniqueEmail("intruder"));
  expect((await intruder.goto(resumeUrl))?.status()).toBe(404);
  expect((await intruder.request.get(`/api/resumes/${resumeId}/export?format=pdf`)).status()).toBe(
    404,
  );
});

test("admin area is invisible to regular users and banning signs a user out", async ({
  browser,
}) => {
  const member = await browser.newPage();
  const memberEmail = uniqueEmail("member");
  await signUpAndOnboard(member, "Member", memberEmail);
  expect((await member.goto("/admin"))?.status()).toBe(404);

  const admin = await browser.newPage();
  const adminEmail = uniqueEmail("admin");
  await signUpAndOnboard(admin, "Admin", adminEmail);
  await sql("update users set role = 'admin' where email = $1", [adminEmail]);

  await admin.goto(`/admin?tab=users&q=${encodeURIComponent(memberEmail)}`);
  admin.once("dialog", (dialog) => dialog.accept());
  await admin.getByRole("button", { name: "Ban" }).click();
  await expect(admin.getByText("User banned")).toBeVisible();

  await member.goto("/dashboard");
  await expect(member).toHaveURL(/\/sign-in/);

  await admin.goto("/admin?tab=audit");
  await expect(
    admin.getByRole("row").filter({ hasText: adminEmail }).filter({ hasText: "admin.user.ban" }),
  ).toBeVisible();
});
