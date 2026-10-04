import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, beforeEach, expect, vi } from 'vite-plus/test';
import { organization, user } from '../../../drizzle/schema';

export let auth: typeof import('./utils/auth').auth;
export let db: typeof import('./utils/db').db;
export let email: typeof import('./utils/email');
export let notificationsResponse: typeof import('./api/notifications.get').notificationsResponse;
export let notificationResponse: typeof import('./routes/notification/[id].get').notificationResponse;
export let appRouter: typeof import('./trpc/routers').appRouter;
const directory = mkdtempSync(join(tmpdir(), 'senv-projects-'));
export let admin: Headers;
export let recipient: Headers;
export let outsider: Headers;
export let recipientId: string;
export let project: { id: string; name: string; slug: string };

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', `file:${join(directory, 'projects.sqlite')}`);
  vi.stubEnv('BETTER_AUTH_SECRET', 'projects-test-secret-at-least-32-characters');
  vi.stubEnv('ROOT_DOMAIN', 'localhost');
  vi.stubEnv('API_URL', 'http://localhost:3000');
  vi.stubEnv('APP_URL', 'http://localhost:4200');
  vi.stubEnv('NODE_ENV', 'development');
  ({ db } = await import('./utils/db'));
  migrate(db, { migrationsFolder: 'drizzle/migrations' });
  ({ auth } = await import('./utils/auth'));
  ({ appRouter } = await import('./trpc/routers'));
  email = await import('./utils/email');
  ({ notificationsResponse } = await import('./api/notifications.get'));
  ({ notificationResponse } = await import('./routes/notification/[id].get'));
});

export async function account(address: string, verified = true) {
  const created = await auth.api.createUser({
    body: {
      name: address,
      email: address,
      password: 'projects-test-password',
      data: { emailVerified: verified },
    },
  });
  const response = await auth.api.signInEmail({
    body: { email: address, password: 'projects-test-password' },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return {
    id: created.user.id,
    headers: new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    }),
  };
}

beforeEach(async () => {
  db.delete(organization).run();
  db.delete(user).run();
  email.clearEmailNotifications();
  admin = (await account('admin@example.com')).headers;
  const invited = await account('recipient@example.com');
  recipient = invited.headers;
  recipientId = invited.id;
  outsider = (await account('outsider@example.com')).headers;
  project = (await auth.api.createOrganization({
    headers: admin,
    body: { name: '  Test project  ', slug: 'client-slug-is-ignored' },
  }))!;
});

afterAll(() => {
  db?.$client.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

export async function invite(role: 'viewer' | 'developer' | 'admin' = 'viewer') {
  return auth.api.createInvitation({
    headers: admin,
    body: {
      email: 'recipient@example.com',
      role,
      organizationId: project.id,
    },
  });
}

export async function request(path: string, headers = new Headers(), body?: unknown) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('origin', 'http://localhost:4200');
  if (body) requestHeaders.set('content-type', 'application/json');
  return auth.handler(
    new Request(`http://localhost:3000/api/auth/organization/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: requestHeaders,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

export function projectCaller(headers: Headers = admin) {
  return appRouter.createCaller({ req: new Request('http://localhost:3000/api/trpc', { headers }) })
    .projects;
}
