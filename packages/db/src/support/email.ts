import { REOPEN_DAYS } from "./rules";

export type CaseEmailEvent = "created" | "reply" | "solved" | "auto_solved";

/** The private link to a case, which works signed out and shows only its public thread. */
export function caseLink(appUrl: string, caseId: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}/support/requests/${caseId}?key=${token}`;
}

const FOOTER = "\n\nReplies to this email aren't read — use the link above.";

/** The email to a requester about their case. */
export function caseEmail(i: {
  number: number;
  subject: string;
  contactName: string;
  contactEmail: string;
  event: CaseEmailEvent;
  body?: string;
  link: string;
}): { to: string; subject: string; text: string } {
  const name = i.contactName.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  const body = {
    created: `We've got your request #${i.number}. We usually reply within a day.\n\n${i.link}`,
    reply: `We replied to your request #${i.number}:\n\n${i.body ?? ""}\n\nAnswer here: ${i.link}`,
    solved: `We've marked your request #${i.number} as solved. If you still need help, reply within ${REOPEN_DAYS} days to reopen it:\n\n${i.link}`,
    auto_solved: `We haven't heard back about request #${i.number}, so we've marked it as solved. Reply within ${REOPEN_DAYS} days to reopen it:\n\n${i.link}`,
  }[i.event];
  return {
    to: i.contactEmail,
    subject: `[#${i.number}] ${i.subject}`,
    text: `${greeting}\n\n${body}${FOOTER}`,
  };
}

/** The in-app notification for a signed-in requester when an agent replies or a case is solved. */
export function caseNotification(i: {
  userId: string;
  caseId: string;
  number: number;
  subject: string;
  event: "reply" | "solved" | "auto_solved";
}): { userId: string; type: "support"; title: string; body: string; link: string } {
  return {
    userId: i.userId,
    type: "support",
    title: i.event === "reply" ? `Reply to request #${i.number}` : `Request #${i.number} solved`,
    body: i.subject,
    link: `/support/requests/${i.caseId}`,
  };
}
