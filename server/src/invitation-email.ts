import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export type InvitationMessage = { to: string; company: string; role: string; acceptanceUrl: string; expiresAt: Date };
export type InvitationMailer = (message: InvitationMessage) => Promise<void>;
export class InvitationEmailError extends Error {
  constructor(public outcome: "failed" | "unknown") { super("Invitation email could not be confirmed."); }
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function invitationMessage(message: InvitationMessage) {
  const role = ({ owner: "company owner", manager: "manager", staff: "staff member", resident: "resident", leaseholder: "leaseholder", occupant: "occupant" } as Record<string, string>)[message.role] || "member";
  const article = /^[aeiou]/i.test(role) ? "an" : "a";
  const subject = `Your invitation to ${message.company.replace(/[\r\n]/g, " ")} on Property Flow`;
  const expiry = message.expiresAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  const text = `${message.company} has invited you to Property Flow as ${article} ${role}.\n\nReview your invitation:\n${message.acceptanceUrl}\n\nSign in with this email address. If you need a password, the invitation page will help you set it up. Review your access before accepting.\n\nThis private link expires ${expiry}. If you did not expect this invitation, you can ignore it.\n\nProperty Flow never asks you to share a password. Help: ${new URL('/help/invitations', message.acceptanceUrl).href}`;
  const html = `<h1>You're invited to Property Flow</h1><p>${escape(message.company)} has invited you as ${article} ${escape(role)}.</p><p><a href="${escape(message.acceptanceUrl)}">Review your invitation</a></p><p>Sign in with this email address. Need a password? The invitation page will help you set it up. You will review your access before accepting.</p><p>This private link expires ${escape(expiry)}. If you did not expect it, you can ignore it.</p><p>Property Flow never asks you to share a password.</p>`;
  return { subject, text, html };
}

export function invitationMailer(env = process.env): InvitationMailer | undefined {
  const from = env.INVITATION_EMAIL_FROM;
  const region = env.INVITATION_EMAIL_REGION || env.AWS_REGION;
  if (!from || !region) return undefined;
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)) throw new Error("INVITATION_EMAIL_FROM must be a sender email address.");
  // SES has no SendEmail idempotency token. Do not retry an ambiguous send.
  const client = new SESv2Client({ region, maxAttempts: 1 });
  return async message => {
    const content = invitationMessage(message);
    try {
      const result = await client.send(new SendEmailCommand({
        FromEmailAddress: `Property Flow <${from}>`,
        Destination: { ToAddresses: [message.to] },
        Content: { Simple: { Subject: { Data: content.subject, Charset: "UTF-8" }, Body: { Text: { Data: content.text, Charset: "UTF-8" }, Html: { Data: content.html, Charset: "UTF-8" } } } },
      }), { abortSignal: AbortSignal.timeout(8000) });
      if (!result.MessageId) throw new InvitationEmailError("unknown");
    } catch (error) {
      if (error instanceof InvitationEmailError) throw error;
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      throw new InvitationEmailError(status && status >= 400 && status < 500 ? "failed" : "unknown");
    }
  };
}
