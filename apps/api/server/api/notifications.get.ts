import { defineHandler } from 'nitro';
import { getEmailNotifications } from '../utils/email-notifications';

export function notificationsResponse() {
  if (process.env['NODE_ENV'] !== 'development') {
    return new Response(null, { status: 404 });
  }
  return Response.json(
    { notifications: getEmailNotifications() },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export default defineHandler(notificationsResponse);
