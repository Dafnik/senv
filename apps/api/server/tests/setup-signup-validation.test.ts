import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';
import { account, user } from '../../../../drizzle/schema.ts';
import {
  adminCookie,
  auth,
  db,
  inviteUser,
  managedUser,
  request,
  signupToken,
} from './setup.test-support.ts';

test('signup rejects invalid passwords, tokens, and untrusted origins without consuming the link', async () => {
  const { token, created } = await inviteUser();
  for (const password of ['short', 'a'.repeat(129)]) {
    expect((await request('account-signup/complete', { token, password })).status).toBe(400);
  }
  expect(
    (await request('account-signup/complete', { token: 'invalid', password: 'valid-password' }))
      .status,
  ).toBe(400);
  expect(
    (
      await request(
        'account-signup/complete',
        { token, password: 'valid-password' },
        'https://other.example.com',
      )
    ).status,
  ).toBe(403);
  expect(db.select().from(user).where(eq(user.id, created.user.id)).get()?.emailVerified).toBe(
    false,
  );
  expect(db.select().from(account).where(eq(account.userId, created.user.id)).all()).toEqual([]);
  expect(
    (await request('account-signup/complete', { token, password: 'valid-password' })).status,
  ).toBe(200);
});

test('resending requires an admin and replaces the old link; completed users cannot be reinvited', async () => {
  const { cookie, created, token } = await inviteUser();
  expect((await request('account-signup/resend', { userId: created.user.id })).status).toBe(401);
  const ordinary = await auth.api.createUser({
    body: { name: 'Other', email: 'other@example.com', password: 'other-password' },
  });
  const login = await request('sign-in/email', {
    email: ordinary.user.email,
    password: 'other-password',
  });
  const userCookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  expect(
    (
      await request('account-signup/resend', { userId: created.user.id }, undefined, {
        cookie: userCookie,
      })
    ).status,
  ).toBe(403);
  expect(
    (await request('account-signup/resend', { userId: created.user.id }, undefined, { cookie }))
      .status,
  ).toBe(200);
  expect(
    (await request('account-signup/complete', { token, password: 'new-password' })).status,
  ).toBe(400);
  expect(
    (await request('account-signup/complete', { token: signupToken(), password: 'new-password' }))
      .status,
  ).toBe(200);
  expect(
    (await request('account-signup/resend', { userId: created.user.id }, undefined, { cookie }))
      .status,
  ).toBe(400);
});

test('expired signup links do not create credentials', async () => {
  const { created, token } = await inviteUser();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date(Date.now() + 60 * 60 * 1000 + 1));
    expect((await request(`account-signup/details?token=${token}`)).status).toBe(400);
    expect(
      (await request('account-signup/complete', { token, password: 'new-password' })).status,
    ).toBe(400);
    expect(db.select().from(account).where(eq(account.userId, created.user.id)).all()).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test.each(['banned', 'deleted', 'email changed'])(
  '%s recipients cannot use the signup link',
  async (change) => {
    const { created, token } = await inviteUser();
    if (change === 'deleted') db.delete(user).where(eq(user.id, created.user.id)).run();
    else
      db.update(user)
        .set(change === 'banned' ? { banned: true } : { email: 'changed@example.com' })
        .where(eq(user.id, created.user.id))
        .run();
    expect(
      (await request('account-signup/complete', { token, password: 'new-password' })).status,
    ).toBe(400);
    expect(db.select().from(account).where(eq(account.userId, created.user.id)).all()).toEqual([]);
  },
);

test('concurrent signup submissions consume the link once and create one credential account', async () => {
  const { created, token } = await inviteUser();
  const responses = await Promise.all([
    request('account-signup/complete', { token, password: 'first-password' }),
    request('account-signup/complete', { token, password: 'second-password' }),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
  expect(db.select().from(account).where(eq(account.userId, created.user.id)).all()).toHaveLength(
    1,
  );
});

test('admins cannot choose a password when creating a user through the API', async () => {
  const cookie = await adminCookie();
  expect(
    (
      await request(
        'admin/create-user',
        { ...managedUser, password: 'admin-password' },
        undefined,
        { cookie },
      )
    ).status,
  ).toBe(400);
  expect(db.select().from(user).all()).toHaveLength(1);
});
