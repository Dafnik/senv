import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vite-plus/test';
import { user } from '../../../drizzle/schema';

export let auth: typeof import('./utils/auth').auth;
export let db: typeof import('./utils/db').db;
export let email: typeof import('./utils/email');
const directory = mkdtempSync(join(tmpdir(), 'senv-setup-'));
export const credentials = {
  name: 'Instance admin',
  email: 'admin@example.com',
  password: 'setup-test-password',
};

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', `file:${join(directory, 'setup.sqlite')}`);
  vi.stubEnv('BETTER_AUTH_SECRET', 'setup-test-secret-at-least-32-characters');
  vi.stubEnv('ROOT_DOMAIN', 'localhost');
  vi.stubEnv('API_URL', 'http://localhost:3000');
  vi.stubEnv('APP_URL', 'http://localhost:4200');
  vi.stubEnv('NODE_ENV', 'development');
  ({ db } = await import('./utils/db'));
  migrate(db, { migrationsFolder: 'drizzle/migrations' });
  ({ auth } = await import('./utils/auth'));
  email = await import('./utils/email');
});

beforeEach(() => {
  db.delete(user).run();
  email.clearEmailNotifications();
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
  db?.$client.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

export function request(
  path: string,
  body?: unknown,
  origin = 'http://localhost:4200',
  headers: Record<string, string> = {},
) {
  return auth.handler(
    new Request(`http://localhost:3000/api/auth/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { origin, ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

export async function adminCookie() {
  await request('instance/setup', credentials);
  const login = await request('sign-in/email', {
    email: credentials.email,
    password: credentials.password,
  });
  return login.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

export const managedUser = { name: 'Managed user', email: 'managed@example.com' };

export function signupToken() {
  const [message] = email.getEmailNotifications();
  const link = message.html.match(/href="(http:\/\/localhost:4200\/signup\?[^"]+)"/)?.[1];
  expect(link).toBeDefined();
  return new URL(link!.replaceAll('&amp;', '&')).searchParams.get('token')!;
}

export async function inviteUser() {
  const cookie = await adminCookie();
  const response = await request('admin/create-user', managedUser, undefined, { cookie });
  expect(response.status).toBe(200);
  return { cookie, created: await response.json(), token: signupToken() };
}
