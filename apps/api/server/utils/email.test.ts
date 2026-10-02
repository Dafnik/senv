import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, expect, test, vi } from 'vite-plus/test';
import { notificationResponse } from '../routes/notification/[id].get';
import { saveEmailNotification } from './email-notifications';
import env from './env';
import { clearEmailNotifications, getEmailNotifications, sendProjectInvitation } from './email';

const { sendMail, createTransport, directory } = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'senv-email-'));
  const sendMail = vi.fn().mockResolvedValue({ messageId: 'test-message' });
  return { sendMail, createTransport: vi.fn().mockReturnValue({ sendMail }), directory };
});

vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('./env', () => ({
  default: {
    APP_URL: 'https://app.example.com',
    API_URL: 'https://api.example.com',
    DATABASE_URL: `file:${directory}/email.sqlite`,
    SMTP_URL: 'smtps://mail.example.com:465',
    EMAIL_FROM: 'senv <noreply@example.com>',
  },
}));

afterAll(() => rmSync(directory, { recursive: true, force: true }));

const input = {
  invitationId: 'random-invitation-id',
  to: 'recipient@example.com',
  role: 'developer',
  projectName: '<script>Project</script>',
  inviterName: 'Alex',
  expiresAt: new Date('2026-10-09T12:00:00Z'),
};

afterEach(() => {
  clearEmailNotifications();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

test('development stores rendered emails without contacting SMTP', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  await sendProjectInvitation(input);
  const [message] = getEmailNotifications();
  expect(message.html).toContain('https://app.example.com/invitations/random-invitation-id');
  expect(message.html).toContain('&lt;script&gt;Project&lt;/script&gt;');
  expect(message.html).not.toContain('<script>Project</script>');
  expect(message.text).toContain('09 Oct 2026 12:00:00 GMT');
  expect(message.previewUrl).toBe(`https://api.example.com/notification/${message.id}`);
  expect(readFileSync(join(directory, 'email-notifications', `${message.id}.html`), 'utf8')).toBe(
    message.html,
  );
  const preview = notificationResponse(message.id);
  expect(preview.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(preview.headers.get('cache-control')).toBe('no-store');
  expect(await preview.text()).toBe(message.html);
  expect(createTransport).not.toHaveBeenCalled();
});

test('production sends HTML and plain text through the configured Node transport', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  await sendProjectInvitation(input);
  expect(createTransport).toHaveBeenCalledWith(env.SMTP_URL);
  expect(sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: `Invitation to ${input.projectName}`,
      html: expect.stringContaining('Review invitation'),
      text: expect.stringContaining('developer'),
    }),
  );
  expect(getEmailNotifications()).toEqual([]);
});

test('missing production delivery configuration fails instead of capturing the email locally', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const smtpUrl = env.SMTP_URL;
  env.SMTP_URL = undefined;
  try {
    await expect(sendProjectInvitation(input)).rejects.toThrow(
      'SMTP_URL and EMAIL_FROM are required',
    );
    expect(createTransport).not.toHaveBeenCalled();
    expect(getEmailNotifications()).toEqual([]);
  } finally {
    env.SMTP_URL = smtpUrl;
  }
});

test('saved emails remain visible to a reloaded module and unknown or invalid preview IDs return 404', async () => {
  vi.stubEnv('NODE_ENV', 'development');
  await sendProjectInvitation(input);
  const [message] = getEmailNotifications();
  vi.resetModules();
  const reloaded = await import('./email-notifications');
  expect(reloaded.getEmailNotifications()).toEqual([message]);
  expect(notificationResponse('00000000-0000-0000-0000-000000000000').status).toBe(404);
  expect(notificationResponse('../email.sqlite').status).toBe(404);
  expect(notificationResponse(undefined).status).toBe(404);
  vi.stubEnv('NODE_ENV', 'production');
  expect(notificationResponse(message.id).status).toBe(404);
});

test('the inbox retains the last 100 messages and removes expired HTML previews', () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
    const message = {
      from: 'senv@example.com',
      to: input.to,
      subject: 'First',
      text: 'First',
      html: '<p>First</p>',
    };
    saveEmailNotification(message);
    const [first] = getEmailNotifications();
    for (let index = 0; index < 100; index++) {
      saveEmailNotification({ ...message, subject: `Message ${index}` });
    }
    expect(getEmailNotifications()).toHaveLength(100);
    expect(getEmailNotifications()[0].subject).toBe('Message 99');
    expect(notificationResponse(first.id).status).toBe(404);
    expect(readdirSync(join(directory, 'email-notifications'))).toHaveLength(200);
    clearEmailNotifications();
    expect(readdirSync(join(directory, 'email-notifications'))).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});
