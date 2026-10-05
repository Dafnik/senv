import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { account, user } from '../../../../../../drizzle/schema.ts';
import { auth, credentials, db, request } from './setup.test-support.ts';

test('an existing admin account closes setup even when unverified or banned', async () => {
  await auth.api.createUser({
    body: { ...credentials, role: 'admin', data: { banned: true } },
  });
  expect(await (await request('instance/setup-status')).json()).toEqual({ needsSetup: false });
  expect(
    (await request('instance/setup', { ...credentials, email: 'new@example.com' })).status,
  ).toBe(403);
});

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
