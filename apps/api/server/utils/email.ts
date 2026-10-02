import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { render, toPlainText } from 'react-email';
import nodemailer from 'nodemailer';
import { ProjectInvitation } from '../emails/project-invitation';
import { EmailVerification } from '../emails/email-verification';
import env from './env';

interface EmailNotification {
  id: string;
  createdAt: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Temporary, bounded, in-memory inbox. Restarting the API clears it.
const notifications: EmailNotification[] = [];
export const getEmailNotifications = () => [...notifications];
export const clearEmailNotifications = () => {
  notifications.length = 0;
};

export async function sendProjectInvitation(input: {
  invitationId: string;
  to: string;
  role: string;
  projectName: string;
  inviterName: string;
  expiresAt: Date;
}) {
  const url = new URL(`/invitations/${encodeURIComponent(input.invitationId)}`, env.APP_URL).href;
  const html = await render(createElement(ProjectInvitation, { ...input, url }));
  await deliverEmail({
    to: input.to,
    subject: `Invitation to ${input.projectName}`,
    html,
  });
}

export async function sendEmailVerification(input: { to: string; name: string; url: string }) {
  const html = await render(createElement(EmailVerification, input));
  await deliverEmail({ to: input.to, subject: 'Verify your email address', html });
}

async function deliverEmail(input: { to: string; subject: string; html: string }) {
  const message = {
    from: env.EMAIL_FROM ?? 'senv <noreply@localhost>',
    ...input,
    text: toPlainText(input.html),
  };

  if (process.env['NODE_ENV'] === 'development') {
    notifications.unshift({ ...message, id: randomUUID(), createdAt: new Date().toISOString() });
    notifications.splice(100);
    return;
  }

  if (!env.SMTP_URL || !env.EMAIL_FROM) {
    throw new Error('SMTP_URL and EMAIL_FROM are required to send emails.');
  }
  await nodemailer.createTransport(env.SMTP_URL).sendMail(message);
}
