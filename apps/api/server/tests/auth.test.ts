import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { account, user } from '../../../../drizzle/schema.ts';

let auth: typeof import('../utils/auth.ts').auth;
let db: typeof import('../utils/db.ts').db;
let adminRouter: typeof import('../trpc/routers/admin.router.ts').adminRouter;
const directory = mkdtempSync(join(tmpdir(), 'senv-auth-'));
const password = 'sqlite-test-password';

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', `file:${join(directory, 'auth.sqlite')}`);
  vi.stubEnv('BETTER_AUTH_SECRET', 'sqlite-test-secret-at-least-32-characters');
  vi.stubEnv('ROOT_DOMAIN', 'localhost');
  vi.stubEnv('API_URL', 'http://localhost:3000');
  vi.stubEnv('APP_URL', 'http://localhost:4200');
  ({ db } = await import('../utils/db.ts'));
  migrate(db, { migrationsFolder: 'drizzle/migrations' });
  ({ auth } = await import('../utils/auth.ts'));
  ({ adminRouter } = await import('../trpc/routers/admin.router.ts'));
});

beforeEach(() => {
  db.delete(user).run();
});

afterAll(() => {
  vi.useRealTimers();
  db?.$client.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

async function createAccount() {
  return auth.api.createUser({ body: { name: 'Test user', email: 'test@example.com', password } });
}

async function signIn() {
  const response = await auth.api.signInEmail({
    body: { email: 'test@example.com', password },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; '),
  });
}

function caller(headers = new Headers()) {
  return adminRouter.createCaller({
    req: new Request('http://localhost:3000/api/trpc/admin.stats', { headers }),
  });
}

test('creates admin-managed accounts and signs in through the Drizzle adapter', async () => {
  const result = await createAccount();
  const saved = db.select().from(user).where(eq(user.id, result.user.id)).get()!;
  expect(saved.emailVerified).toBe(false);
  expect(saved.createdAt).toBeInstanceOf(Date);
  expect(db.select().from(account).get()!.password).toBeTruthy();
  const session = await auth.api.getSession({ headers: await signIn() });
  expect(session?.user.id).toBe(result.user.id);
  expect(session?.session.expiresAt).toBeInstanceOf(Date);
});

test('requires an authenticated admin for statistics', async () => {
  await expect(caller().stats()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  await createAccount();
  await expect(caller(await signIn()).stats()).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

test('counts users at both seven-day boundaries and calculates the trend', async () => {
  const now = new Date('2026-10-02T12:00:00.000Z');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  const result = await createAccount();
  const day = 24 * 60 * 60 * 1000;
  db.update(user)
    .set({ role: 'admin', createdAt: new Date(now.getTime() - 30 * day) })
    .where(eq(user.id, result.user.id))
    .run();
  const ages = [0, day, 7 * day, 7 * day + 1, 14 * day, 14 * day + 1];
  db.insert(user)
    .values(
      ages.map((age, index) => ({
        id: `user-${index}`,
        name: `User ${index}`,
        email: `user-${index}@example.com`,
        createdAt: new Date(now.getTime() - age),
      })),
    )
    .run();
  expect(await caller(await signIn()).stats()).toEqual({
    totalUsers: 7,
    newUsersLast7Days: 3,
    newUsersTrend: 50,
  });
  vi.useRealTimers();
});

test('handles an empty previous week and rejects banned users', async () => {
  const result = await createAccount();
  db.update(user).set({ role: 'admin' }).where(eq(user.id, result.user.id)).run();
  const headers = await signIn();
  expect(await caller(headers).stats()).toEqual({
    totalUsers: 1,
    newUsersLast7Days: 1,
    newUsersTrend: 0,
  });
  const users = await auth.api.listUsers({ headers, query: { limit: 10 } });
  expect(users.total).toBe(1);
  expect(users.users[0].createdAt).toBeInstanceOf(Date);
  expect(users.users[0].emailVerified).toBe(false);
  db.update(user)
    .set({ banned: true, banReason: 'Test ban' })
    .where(eq(user.id, result.user.id))
    .run();
  const response = await auth.api.signInEmail({
    body: { email: 'test@example.com', password },
    asResponse: true,
  });
  expect(response.status).toBe(403);
});
