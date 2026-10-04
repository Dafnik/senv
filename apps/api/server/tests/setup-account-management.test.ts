import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { account, user } from '../../../../drizzle/schema.ts';
import { adminCookie, auth, credentials, db, request } from './setup.test-support.ts';

test('last-admin demotion and deletion leave setup closed and credentials intact', async () => {
  const cookie = await adminCookie();
  const admin = db.select().from(user).get()!;
  const savedCredential = db.select().from(account).get()!;
  expect(
    (await request('admin/set-role', { userId: admin.id, role: 'user' }, undefined, { cookie }))
      .status,
  ).toBe(403);
  expect(
    (
      await request('admin/update-user', { userId: admin.id, data: { role: 'user' } }, undefined, {
        cookie,
      })
    ).status,
  ).toBe(400);
  expect(
    (await request('admin/remove-user', { userId: admin.id }, undefined, { cookie })).status,
  ).toBe(400);
  expect(db.select().from(account).get()).toEqual(savedCredential);
  expect(await (await request('instance/setup-status')).json()).toEqual({ needsSetup: false });
  expect(
    (await request('instance/setup', { ...credentials, email: 'attacker@example.com' })).status,
  ).toBe(403);
});

test('role changes accept one role and reject alternate representations and unauthenticated writes', async () => {
  const cookie = await adminCookie();
  const created = await auth.api.createUser({
    body: { name: 'Second admin', email: 'second@example.com', password: 'second-admin-password' },
  });
  for (const role of [['admin'], ['admin', 'user'], 'admin,user', null, 'owner']) {
    expect(
      (await request('admin/set-role', { userId: created.user.id, role }, undefined, { cookie }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(
          'admin/create-user',
          { name: 'Bad role', email: 'badrole@example.com', data: { role } },
          undefined,
          { cookie },
        )
      ).status,
    ).toBe(400);
  }
  expect((await request('admin/set-role', { userId: created.user.id, role: 'admin' })).status).toBe(
    401,
  );
  expect(
    (
      await request('admin/set-role', { userId: created.user.id, role: 'admin' }, undefined, {
        cookie,
      })
    ).status,
  ).toBe(200);
  const first = db.select().from(user).where(eq(user.email, credentials.email)).get()!;
  expect(
    (await request('admin/set-role', { userId: first.id, role: 'user' }, undefined, { cookie }))
      .status,
  ).toBe(200);
  expect(db.select().from(user).where(eq(user.id, first.id)).get()!.role).toBe('user');
  expect(
    (await request('admin/remove-user', { userId: created.user.id }, undefined, { cookie })).status,
  ).toBe(403);
});

test('concurrent cross-deletion preserves one admin together with its credentials and session', async () => {
  const cookie = await adminCookie();
  const first = db.select().from(user).get()!;
  const second = await auth.api.createUser({
    body: {
      name: 'Second admin',
      email: 'second@example.com',
      password: 'second-admin-password',
      role: 'admin',
    },
  });
  const login = await request('sign-in/email', {
    email: 'second@example.com',
    password: 'second-admin-password',
  });
  const secondCookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const results = await Promise.all([
    request('admin/remove-user', { userId: second.user.id }, undefined, { cookie }),
    request('admin/remove-user', { userId: first.id }, undefined, { cookie: secondCookie }),
  ]);
  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  expect(results.filter((r) => r.status === 401 || r.status === 403)).toHaveLength(1);
  const remaining = db.select().from(user).get()!;
  expect(remaining.role).toBe('admin');
  expect(
    db.select().from(account).where(eq(account.userId, remaining.id)).get()?.password,
  ).toBeTruthy();
  expect(
    await auth.api.getSession({
      headers: new Headers({ cookie: remaining.id === first.id ? cookie : secondCookie }),
    }),
  ).toBeTruthy();
});
