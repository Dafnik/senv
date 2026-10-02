import { createElement } from 'react';
import { render, toPlainText } from 'react-email';
import nodemailer from 'nodemailer';
import { ProjectInvitation } from '../emails/project-invitation';
import { EmailVerification } from '../emails/email-verification';
import { PasswordReset } from '../emails/password-reset';
import { AccountSignup } from '../emails/account-signup';
import env from './env';
import { saveEmailNotification } from './email-notifications';

export { clearEmailNotifications, getEmailNotifications } from './email-notifications';

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

export async function sendAccountSignup(input: { to: string; name: string; url: string }) {
  const html = await render(createElement(AccountSignup, input));
  await deliverEmail({ to: input.to, subject: 'Finish setting up your senv account', html });
}

export async function sendPasswordReset(input: { to: string; name: string; url: string }) {
  const html = await render(createElement(PasswordReset, input));
  await deliverEmail({ to: input.to, subject: 'Reset your senv password', html });
}

async function deliverEmail(input: { to: string; subject: string; html: string }) {
  const message = {
    from: env.EMAIL_FROM ?? 'senv <noreply@localhost>',
    ...input,
    text: toPlainText(input.html),
  };

  if (process.env['NODE_ENV'] === 'development') {
    saveEmailNotification(message);
    return;
  }

  if (!env.SMTP_URL || !env.EMAIL_FROM) {
    throw new Error('SMTP_URL and EMAIL_FROM are required to send emails.');
  }
  await nodemailer.createTransport(env.SMTP_URL).sendMail(message);
}
