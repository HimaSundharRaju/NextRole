import { describe, expect, it } from "vitest";
import { caseEmail, caseLink, caseNotification } from "./email";

describe("caseEmail", () => {
  it("writes reply emails with the subject format, the reply and the link", () => {
    const email = caseEmail({
      number: 1042,
      subject: "Can't sign in",
      contactName: "Riya",
      contactEmail: "riya@example.com",
      event: "reply",
      body: "Try the reset link.",
      link: "https://app.test/support/requests/c1?key=k",
    });
    expect(email).toMatchObject({ to: "riya@example.com", subject: "[#1042] Can't sign in" });
    expect(email.text).toContain("We replied to your request #1042:\n\nTry the reset link.");
    expect(email.text).toContain("Answer here: https://app.test/support/requests/c1?key=k");
    expect(email.text.endsWith("Replies to this email aren't read — use the link above.")).toBe(
      true,
    );
    const unnamed = caseEmail({
      number: 7,
      subject: "Hello",
      contactName: "",
      contactEmail: "a@b.co",
      event: "created",
      link: "L",
    });
    expect(unnamed.text.startsWith("Hi,\n\n")).toBe(true);
  });

  it("says what happened in the created, solved and auto-solved emails", () => {
    const base = {
      number: 1042,
      subject: "Can't sign in",
      contactName: "Riya",
      contactEmail: "riya@example.com",
      link: "LINK",
    };
    expect(caseEmail({ ...base, event: "created" }).text).toContain(
      "We've got your request #1042. We usually reply within a day.\n\nLINK",
    );
    expect(caseEmail({ ...base, event: "solved" }).text).toContain(
      "We've marked your request #1042 as solved. If you still need help, reply within 14 days to reopen it:\n\nLINK",
    );
    expect(caseEmail({ ...base, event: "auto_solved" }).text).toContain(
      "We haven't heard back about request #1042, so we've marked it as solved. Reply within 14 days to reopen it:\n\nLINK",
    );
  });
});

describe("caseLink and caseNotification", () => {
  it("builds the private link, with or without a trailing slash on the app URL", () => {
    expect(caseLink("https://app.test", "c1", "tok")).toBe(
      "https://app.test/support/requests/c1?key=tok",
    );
    expect(caseLink("https://app.test/", "c1", "tok")).toBe(
      "https://app.test/support/requests/c1?key=tok",
    );
  });

  it("titles in-app notifications for replies and solves, linking to the thread", () => {
    const base = { userId: "u1", caseId: "c1", number: 1042, subject: "Can't sign in" };
    expect(caseNotification({ ...base, event: "reply" })).toEqual({
      userId: "u1",
      type: "support",
      title: "Reply to request #1042",
      body: "Can't sign in",
      link: "/support/requests/c1",
    });
    expect(caseNotification({ ...base, event: "solved" }).title).toBe("Request #1042 solved");
    expect(caseNotification({ ...base, event: "auto_solved" }).title).toBe("Request #1042 solved");
  });
});
