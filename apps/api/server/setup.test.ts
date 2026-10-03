import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { account, user, verification } from '../../../drizzle/schema';

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

afterEach(() => vi.restoreAllMocks());

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

async function adminCookie() {
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

const managedUser = { name: 'Managed user', email: 'managed@example.com' };

function signupToken() {
  const [message] = email.getEmailNotifications();
  const link = message.html.match(/href="(http:\/\/localhost:4200\/signup\?[^"]+)"/)?.[1];
  expect(link).toBeDefined();
  return new URL(link!.replaceAll('&amp;', '&')).searchParams.get('token')!;
}

async function inviteUser() {
  const cookie = await adminCookie();
  const response = await request('admin/create-user', managedUser, undefined, { cookie });
  expect(response.status).toBe(200);
  return { cookie, created: await response.json(), token: signupToken() };
}

test('Add user sends a signup email; password submission verifies the user and logs them in', async () => {
  const { created, token, cookie } = await inviteUser();
  expect(created.signupEmailSent).toBe(true);
  expect(created.user.emailVerified).toBe(false);
  expect(db.select().from(account).where(eq(account.userId, created.user.id)).all()).toEqual([]);
  const [message] = email.getEmailNotifications();
  expect(message.to).toBe(managedUser.email);
  expect(message.subject).toBe('Finish setting up your senv account');
  expect(message.previewUrl).toBe(`http://localhost:3000/notification/${message.id}`);
  const { notificationResponse } = await import('./routes/notification/[id].get');
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
