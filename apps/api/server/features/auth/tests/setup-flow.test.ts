import { expect, test } from 'vite-plus/test';
import { account, user } from '../../../../../../drizzle/schema.ts';
import { auth, credentials, db, email, request } from './setup.test-support.ts';

test('setup creates the first admin and permits immediate sign-in without verification', async () => {
  const status = await request('instance/setup-status');
  expect(await status.json()).toEqual({ needsSetup: true });
  expect(status.headers.get('cache-control')).toBe('no-store');
  expect(
    (await request('instance/setup', { ...credentials, emailVerified: false, role: 'user' }))
      .status,
  ).toBe(200);
  const saved = db.select().from(user).get()!;
  expect(saved.role).toBe('admin');
  expect(saved.emailVerified).toBe(true);
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
  expect(session?.user.emailVerified).toBe(true);
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
          name: credentials.name,
          email: 'public@example.com',
          role: 'admin',
        })
      ).status,
    ).toBe(401);
  }
  expect(db.select().from(user).all()).toHaveLength(1);
  expect(email.getEmailNotifications()).toEqual([]);
});
