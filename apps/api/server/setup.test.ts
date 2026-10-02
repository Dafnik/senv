import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { account, user } from '../../../drizzle/schema';

let auth: typeof import('./utils/auth').auth;
let db: typeof import('./utils/db').db;
let email: typeof import('./utils/email');
const directory = mkdtempSync(join(tmpdir(), 'senv-setup-'));
const credentials = {
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

afterAll(() => {
  db?.$client.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function request(
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

test('setup creates the first admin and permits immediate sign-in without verification', async () => {
  const status = await request('instance/setup-status');
  expect(await status.json()).toEqual({ needsSetup: true });
  expect(status.headers.get('cache-control')).toBe('no-store');
  expect(
    (await request('instance/setup', { ...credentials, emailVerified: true, role: 'user' })).status,
  ).toBe(200);
  const saved = db.select().from(user).get()!;
  expect(saved.role).toBe('admin');
  expect(saved.emailVerified).toBe(false);
  const credential = db.select().from(account).get()!;
  expect(credential.userId).toBe(saved.id);
  expect(credential.password).not.toBe(credentials.password);
  expect(email.getEmailNotifications()).toEqual([]);
  expect(await (await request('instance/setup-status')).json()).toEqual({ needsSetup: false });
  const login = await request('sign-in/email', {
    email: credentials.email,
    password: credentials.password,
  });
  expect(login.status).toBe(200);
  const headers = new Headers({
    cookie: login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; '),
  });
  const session = await auth.api.getSession({ headers });
  expect(session?.user.role).toBe('admin');
  expect(session?.user.emailVerified).toBe(false);
  const created = await auth.api.createUser({
    headers,
    body: { name: 'Managed user', email: 'managed@example.com', password: 'managed-test-password' },
  });
  expect(created.user.role).toBe('user');
  expect(
    (await request('instance/setup', { ...credentials, email: 'another@example.com' })).status,
  ).toBe(403);
  expect(db.select().from(user).all()).toHaveLength(2);
});

test('public signup and unauthenticated admin account creation are disabled before and after setup', async () => {
  for (const initialized of [false, true]) {
    if (initialized) await request('instance/setup', credentials);
    const signup = await request('sign-up/email', { ...credentials, email: 'public@example.com' });
    expect(signup.status).toBe(400);
    expect((await signup.json()).code).toBe('EMAIL_PASSWORD_SIGN_UP_DISABLED');
    expect(
      (
        await request('admin/create-user', {
          ...credentials,
          email: 'public@example.com',
          role: 'admin',
        })
      ).status,
    ).toBe(401);
  }
  expect(db.select().from(user).all()).toHaveLength(1);
});

test.each(['admin', 'user,admin', 'admin,user'])(
  'an existing %s account closes setup even when unverified or banned',
  async (role) => {
    const existing = await auth.api.createUser({
      body: { ...credentials, role: 'admin', data: { banned: true } },
    });
    db.update(user).set({ role }).where(eq(user.id, existing.user.id)).run();
    expect(await (await request('instance/setup-status')).json()).toEqual({ needsSetup: false });
    expect(
      (await request('instance/setup', { ...credentials, email: 'new@example.com' })).status,
    ).toBe(403);
  },
);

test('instances with ordinary users can be set up without replacing an existing account', async () => {
  const existing = await auth.api.createUser({ body: { ...credentials, role: 'user' } });
  expect(await (await request('instance/setup-status')).json()).toEqual({ needsSetup: true });
  expect(
    (await request('instance/setup', { ...credentials, email: 'ADMIN@example.com' })).status,
  ).toBe(409);
  expect(db.select().from(user).where(eq(user.id, existing.user.id)).get()?.role).toBe('user');
  expect(
    (await request('instance/setup', { ...credentials, email: 'new@example.com' })).status,
  ).toBe(200);
  expect(db.select().from(user).all()).toHaveLength(2);
});

test('concurrent setup requests have one winner and no partial account records', async () => {
  const responses = await Promise.all([
    request('instance/setup', credentials),
    request('instance/setup', { ...credentials, email: 'second@example.com' }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 403]);
  expect(db.select().from(user).all()).toHaveLength(1);
  expect(db.select().from(account).all()).toHaveLength(1);
});

test('setup rejects invalid inputs and cross-origin requests without creating users', async () => {
  for (const body of [
    { ...credentials, password: 'short' },
    { ...credentials, password: 'a'.repeat(129) },
    { ...credentials, name: '   ' },
    { ...credentials, email: 'invalid' },
  ]) {
    expect((await request('instance/setup', body)).status).toBe(400);
  }
  expect((await request('instance/setup', credentials, 'https://other.example.com')).status).toBe(
    403,
  );
  expect(db.select().from(user).all()).toEqual([]);
  expect(db.select().from(account).all()).toEqual([]);
});

test('setup, admin-managed accounts and sign-in all require a valid email address', async () => {
  expect((await request('instance/setup', credentials)).status).toBe(200);
  const login = await request('sign-in/email', {
    email: credentials.email,
    password: credentials.password,
  });
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  for (const email of [undefined, '', 'not-an-email']) {
    expect(
      (
        await request(
          'admin/create-user',
          { name: 'User', email, password: credentials.password },
          'http://localhost:4200',
          { cookie },
        )
      ).status,
    ).toBe(400);
    expect((await request('sign-in/email', { email, password: credentials.password })).status).toBe(
      400,
    );
  }
  expect(db.select().from(user).all()).toHaveLength(1);
});
