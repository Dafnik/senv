import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';
import { account, user } from '../../../../drizzle/schema.ts';
import {
  adminCookie,
  auth,
  db,
  email,
  inviteUser,
  managedUser,
  request,
  signupToken,
} from './setup.test-support.ts';

test('Add user sends a signup email; password submission verifies the user and logs them in', async () => {
  const { created, token, cookie } = await inviteUser();
  expect(created.signupEmailSent).toBe(true);
  expect(created.user.emailVerified).toBe(false);
  expect(db.select().from(account).where(eq(account.userId, created.user.id)).all()).toEqual([]);
  const [message] = email.getEmailNotifications();
  expect(message.to).toBe(managedUser.email);
  expect(message.subject).toBe('Finish setting up your senv account');
  expect(message.previewUrl).toBe(`http://localhost:3000/notification/${message.id}`);
  const { notificationResponse } = await import('../routes/notification/[id].get.ts');
  expect(await notificationResponse(message.id).text()).toBe(message.html);

  for (let i = 0; i < 2; i++) {
    const details = await request(`account-signup/details?token=${token}`);
    expect(details.status).toBe(200);
    expect(details.headers.get('cache-control')).toBe('no-store');
    expect(await details.json()).toEqual(managedUser);
  }
  expect(db.select().from(user).where(eq(user.id, created.user.id)).get()?.emailVerified).toBe(
    false,
  );
  const password = 'my-own-password';
  expect((await request('sign-in/email', { email: managedUser.email, password })).status).toBe(401);
  const response = await request('account-signup/complete', {
    token,
    password,
    role: 'admin',
    email: 'other@example.com',
  });
  expect(response.status).toBe(200);
  const signupSession = await auth.api.getSession({
    headers: new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    }),
  });
  expect(signupSession?.user).toMatchObject({
    id: created.user.id,
    email: managedUser.email,
    emailVerified: true,
    role: 'user',
  });
  expect(
    db.select().from(account).where(eq(account.userId, created.user.id)).get()?.password,
  ).not.toBe(password);
  expect((await request('sign-in/email', { email: managedUser.email, password })).status).toBe(200);
  expect(
    (await request('account-signup/complete', { token, password: 'changed-password' })).status,
  ).toBe(400);
  expect((await request(`account-signup/details?token=${token}`)).status).toBe(400);
  expect((await request('admin/create-user', managedUser, undefined, { cookie })).status).toBe(400);
  expect(email.getEmailNotifications()).toHaveLength(1);
});

test('failed delivery preserves a passwordless account and admins can resend signup', async () => {
  const cookie = await adminCookie();
  vi.spyOn(email, 'sendAccountSignup').mockRejectedValueOnce(new Error('Mail unavailable'));
  const response = await request('admin/create-user', managedUser, undefined, { cookie });
  expect(response.status).toBe(200);
  const created = await response.json();
  expect(created.signupEmailSent).toBe(false);
  expect(db.select().from(user).where(eq(user.id, created.user.id)).get()?.emailVerified).toBe(
    false,
  );
  expect(db.select().from(account).where(eq(account.userId, created.user.id)).all()).toEqual([]);
  expect(email.getEmailNotifications()).toEqual([]);
  expect(
    (await request('account-signup/resend', { userId: created.user.id }, undefined, { cookie }))
      .status,
  ).toBe(200);
  expect(email.getEmailNotifications()).toHaveLength(1);
  expect(
    (
      await request('account-signup/complete', {
        token: signupToken(),
        password: 'recipient-password',
      })
    ).status,
  ).toBe(200);
  expect(db.select().from(user).all()).toHaveLength(2);
});
