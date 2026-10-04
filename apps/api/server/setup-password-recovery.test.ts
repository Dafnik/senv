import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';
import { user, verification } from '../../../drizzle/schema';
import { adminCookie, auth, credentials, db, email, request } from './setup.test-support';

test('admin-chosen password endpoint is disabled while email resets are single-use and revoke sessions', async () => {
  const cookie = await adminCookie();
  const created = await auth.api.createUser({
    body: {
      name: 'Existing',
      email: 'existing@example.com',
      password: 'existing-old-password',
      data: { emailVerified: true },
    },
  });
  const login = await request('sign-in/email', {
    email: 'existing@example.com',
    password: 'existing-old-password',
  });
  const userCookie = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  expect(
    (
      await request(
        'admin/set-user-password',
        { userId: created.user.id, newPassword: 'admin-chosen-password' },
        undefined,
        { cookie },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request('account-password/admin-reset', { userId: created.user.id }, undefined, {
        cookie: userCookie,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request('account-password/admin-reset', { userId: created.user.id }, undefined, {
        cookie,
      })
    ).status,
  ).toBe(200);
  const message = email.getEmailNotifications().find((m) => m.to === 'existing@example.com')!;
  const resetUrl = message.text.match(
    /http:\/\/localhost:4200\/reset-password\?token=[A-Za-z0-9_-]+/,
  )![0];
  const token = new URL(resetUrl).searchParams.get('token')!;
  const responses = await Promise.all(
    [0, 1].map(() =>
      request('account-password/complete', { token, password: 'existing-new-password' }),
    ),
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
  expect(await auth.api.getSession({ headers: new Headers({ cookie: userCookie }) })).toBeNull();
  expect(
    (
      await request('sign-in/email', {
        email: 'existing@example.com',
        password: 'existing-old-password',
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await request('sign-in/email', {
        email: 'existing@example.com',
        password: 'existing-new-password',
      })
    ).status,
  ).toBe(200);
});

test('public recovery conceals missing, banned and pending accounts without enabling signup bypass', async () => {
  const cookie = await adminCookie();
  await request('admin/create-user', { name: 'Pending', email: 'pending@example.com' }, undefined, {
    cookie,
  });
  const pending = db.select().from(user).where(eq(user.email, 'pending@example.com')).get()!;
  email.clearEmailNotifications();
  for (const emailAddress of ['pending@example.com', 'missing@example.com']) {
    expect((await request('account-password/request', { email: emailAddress })).status).toBe(200);
  }
  expect(email.getEmailNotifications()).toHaveLength(0);
  expect(
    (await request('account-password/admin-reset', { userId: pending.id }, undefined, { cookie }))
      .status,
  ).toBe(400);
  expect(
    (
      await request(
        'account-password/request',
        { email: credentials.email },
        'https://untrusted.example',
      )
    ).status,
  ).toBe(403);
  expect((await request('account-password/request', { email: credentials.email })).status).toBe(
    200,
  );
  expect(email.getEmailNotifications()).toHaveLength(1);
});

test('profile reset uses the signed-in account and requires email proof before changing its password', async () => {
  const cookie = await adminCookie();
  expect((await request('account-password/self-reset', {})).status).toBe(401);
  expect(
    (await request('account-password/self-reset', {}, 'https://untrusted.example', { cookie }))
      .status,
  ).toBe(403);
  expect(
    (
      await request(
        'account-password/self-reset',
        { userId: 'another-user', email: 'other@example.com' },
        undefined,
        { cookie },
      )
    ).status,
  ).toBe(200);
  const message = email.getEmailNotifications()[0];
  expect(message.to).toBe(credentials.email);
  const link = message.text.match(
    /http:\/\/localhost:4200\/reset-password\?token=[A-Za-z0-9_-]+/,
  )![0];
  const token = new URL(link).searchParams.get('token')!;
  expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeTruthy();
  expect(
    (await request('sign-in/email', { email: credentials.email, password: credentials.password }))
      .status,
  ).toBe(200);
  expect(
    (await request('account-password/complete', { token, password: 'profile-new-password' }))
      .status,
  ).toBe(200);
  expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  expect(
    (await request('account-password/complete', { token, password: 'profile-new-password' }))
      .status,
  ).toBe(400);
  expect(
    (await request('sign-in/email', { email: credentials.email, password: 'profile-new-password' }))
      .status,
  ).toBe(200);
});

test('profile reset reports email delivery failure and removes the failed token', async () => {
  const cookie = await adminCookie();
  vi.spyOn(email, 'sendPasswordReset').mockRejectedValueOnce(new Error('Delivery unavailable'));
  const response = await request('account-password/self-reset', {}, undefined, { cookie });
  expect(response.status).toBe(500);
  expect((await response.json()).message).toBe(
    'The reset email could not be sent. Please try again.',
  );
  expect(email.getEmailNotifications()).toHaveLength(0);
  const actor = db.select().from(user).where(eq(user.email, credentials.email)).get()!;
  expect(
    db
      .select()
      .from(verification)
      .where(eq(verification.value, JSON.stringify({ userId: actor.id, email: actor.email })))
      .all(),
  ).toHaveLength(0);
  expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeTruthy();
});
