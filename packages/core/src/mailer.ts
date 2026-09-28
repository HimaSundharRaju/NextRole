import nodemailer, { type Transporter } from "nodemailer";
import { createLogger } from "./logger";

const log = createLogger("mailer");

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter | undefined {
  if (transporter) return transporter;
  const url = process.env.SMTP_URL;
  if (!url) return undefined;
  transporter = nodemailer.createTransport(url);
  return transporter;
}

/**
 * Sends a transactional email. Without SMTP_URL (local development) the message is written to
 * the log instead; in production a missing SMTP_URL is a configuration error.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP_URL is not configured; cannot send email in production");
    }
    log.info(
      { subject: message.subject, body: message.text },
      "email (SMTP_URL not set, not sent)",
    );
    return;
  }
  await transport.sendMail({
    from: process.env.EMAIL_FROM ?? "GetTargetRole <no-reply@gettargetrole.app>",
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
