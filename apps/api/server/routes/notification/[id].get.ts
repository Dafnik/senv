import { defineHandler } from 'nitro';
import { getRouterParam } from 'nitro/h3';
import { getEmailNotificationHtml } from '../../utils/email-notifications';

export function notificationResponse(id: string | undefined) {
  if (process.env['NODE_ENV'] !== 'development' || !id) return new Response(null, { status: 404 });
  const html = getEmailNotificationHtml(id);
  if (html === undefined) return new Response(null, { status: 404 });
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src https: http: data:; font-src https:",
    },
  });
}

export default defineHandler((event) => notificationResponse(getRouterParam(event, 'id')));
