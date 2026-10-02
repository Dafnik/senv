import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import env from './env';

interface SavedEmailNotification {
  order?: number;
  id: string;
  createdAt: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface EmailNotification extends Omit<SavedEmailNotification, 'order'> {
  html: string;
  previewUrl: string;
}

// Keep the development inbox beside its database, including across Nitro reloads.
const directory = join(dirname(resolve(env.DATABASE_URL.slice(5))), 'email-notifications');
const notificationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function savedNotifications(): SavedEmailNotification[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json') && notificationId.test(file.slice(0, -5)))
    .map(
      (file) => JSON.parse(readFileSync(join(directory, file), 'utf8')) as SavedEmailNotification,
    )
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || b.createdAt.localeCompare(a.createdAt));
}

export function getEmailNotifications(): EmailNotification[] {
  if (process.env['NODE_ENV'] !== 'development') return [];
  return savedNotifications().map(({ id, createdAt, from, to, subject, text }) => ({
    id,
    createdAt,
    from,
    to,
    subject,
    text,
    html: readFileSync(join(directory, `${id}.html`), 'utf8'),
    previewUrl: new URL(`/notification/${id}`, env.API_URL).href,
  }));
}

export function getEmailNotificationHtml(id: string): string | undefined {
  if (!notificationId.test(id)) return undefined;
  const path = join(directory, `${id}.html`);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

export function clearEmailNotifications() {
  for (const notification of savedNotifications()) removeNotification(notification.id);
}

function removeNotification(id: string) {
  rmSync(join(directory, `${id}.json`), { force: true });
  rmSync(join(directory, `${id}.html`), { force: true });
}

export function saveEmailNotification(
  message: Omit<EmailNotification, 'id' | 'createdAt' | 'previewUrl'>,
) {
  const { html, ...metadata } = message;
  const previous = savedNotifications();
  const notification = {
    ...metadata,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    // Preserve send order even when emails share a timestamp or the clock changes.
    order: (previous[0]?.order ?? 0) + 1,
  };
  mkdirSync(directory, { recursive: true });
  // Write metadata last so only completed captures appear in the inbox.
  writeFileSync(join(directory, `${notification.id}.html`), html, 'utf8');
  writeFileSync(join(directory, `${notification.id}.json`), JSON.stringify(notification), 'utf8');
  for (const expired of previous.slice(99)) removeNotification(expired.id);
}
