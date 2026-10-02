import { afterEach, expect, test, vi } from 'vite-plus/test';
import env from './env';
import { clearEmailNotifications, getEmailNotifications, sendProjectInvitation } from './email';

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: 'test-message' });
  return { sendMail, createTransport: vi.fn().mockReturnValue({ sendMail }) };
});

vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('./env', () => ({
  default: {
    APP_URL: 'https://app.example.com',
    SMTP_URL: 'smtps://mail.example.com:465',
    EMAIL_FROM: 'senv <noreply@example.com>',
  },
}));

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
