/** What a person is told when customer care answers their request to add a company. */
export function companyRequestMessages(
  input: {
    companyName: string;
    userName: string;
    appUrl: string;
  } & ({ outcome: "added" } | { outcome: "declined"; reason: string }),
): {
  notification: { title: string; body: string; link: string };
  email: { subject: string; text: string };
} {
  const name = input.companyName;
  const greeting = input.userName.trim() ? `Hi ${input.userName.trim()},` : "Hi,";
  if (input.outcome === "added") {
    return {
      notification: {
        title: `We added ${name}`,
        body: "Its jobs will show up within the hour.",
        link: "/jobs",
      },
      email: {
        subject: `We added ${name} to GetTargetRole`,
        text: `${greeting}\n\nYou asked us to add ${name}. It's on GetTargetRole now, and its open jobs will show up within the hour:\n${input.appUrl.replace(/\/+$/, "")}/jobs`,
      },
    };
  }
  return {
    notification: { title: `We couldn't add ${name}`, body: input.reason, link: "/jobs" },
    email: {
      subject: `We couldn't add ${name}`,
      text: `${greeting}\n\nYou asked us to add ${name}, but we couldn't: ${input.reason}`,
    },
  };
}
