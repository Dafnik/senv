import env from '../../../infrastructure/env';
import {
  getEmailNotificationHtml,
  savedNotifications,
  type SavedEmailNotification,
} from '../repositories/email-notifications';
export {
  clearEmailNotifications,
  getEmailNotificationHtml,
  saveEmailNotification,
} from '../repositories/email-notifications';

export interface EmailNotification extends Omit<SavedEmailNotification, 'order'> {
  html: string;
  previewUrl: string;
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
    html: getEmailNotificationHtml(id)!,
    previewUrl: new URL(`/notification/${id}`, env.API_URL).href,
  }));
}
