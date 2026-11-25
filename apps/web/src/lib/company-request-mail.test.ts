import { describe, expect, it } from "vitest";
import { companyRequestMessages } from "./company-request-mail";

describe("companyRequestMessages", () => {
  const base = { companyName: "Globex", userName: "Riya", appUrl: "https://app.test" };

  it("tells the requester the company was added, in the app and by email", () => {
    expect(companyRequestMessages({ ...base, outcome: "added" })).toEqual({
      notification: {
        title: "We added Globex",
        body: "Its jobs will show up within the hour.",
        link: "/jobs",
      },
      email: {
        subject: "We added Globex to GetTargetRole",
        text: "Hi Riya,\n\nYou asked us to add Globex. It's on GetTargetRole now, and its open jobs will show up within the hour:\nhttps://app.test/jobs",
      },
    });
  });

  it("gives the reason when the company couldn't be added", () => {
    expect(
      companyRequestMessages({
        ...base,
        outcome: "declined",
        reason: "Their jobs are only on LinkedIn.",
      }),
    ).toEqual({
      notification: {
        title: "We couldn't add Globex",
        body: "Their jobs are only on LinkedIn.",
        link: "/jobs",
      },
      email: {
        subject: "We couldn't add Globex",
        text: "Hi Riya,\n\nYou asked us to add Globex, but we couldn't: Their jobs are only on LinkedIn.",
      },
    });
  });

  it("copes with a trailing slash on the app URL and a name we don't have", () => {
    const message = companyRequestMessages({
      ...base,
      appUrl: "https://app.test/",
      userName: "",
      outcome: "added",
    });
    expect(message.email.text).toBe(
      "Hi,\n\nYou asked us to add Globex. It's on GetTargetRole now, and its open jobs will show up within the hour:\nhttps://app.test/jobs",
    );
  });
});
