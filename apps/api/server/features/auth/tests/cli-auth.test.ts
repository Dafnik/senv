import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { automationToken, deviceCode, session, user } from '../../../../../../drizzle/schema';
import { adminCookie, auth, credentials, db, email, request } from './setup.test-support';

test('device authorization produces a separate labeled session, without exposing secrets in lists', async () => {
  const cookie = await adminCookie();
  const codeResponse = await request('device/code', { client_id: 'senv-cli' }, undefined, {
    'x-senv-device-label': 'Test terminal',
    'x-senv-cli-version': '0.1.0',
  });
  expect(codeResponse.status).toBe(200);
  const code = await codeResponse.json();
  expect(code.verification_uri).toBe('http://localhost:4200/cli/authorize');
  expect(
    (await request(`device?user_code=${code.user_code}`, undefined, undefined, { cookie })).status,
  ).toBe(200);
  expect(
    (await request('device/approve', { userCode: code.user_code }, undefined, { cookie })).status,
  ).toBe(200);
  const tokenResponse = await request('device/token', {
    client_id: 'senv-cli',
    device_code: code.device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  expect(tokenResponse.status).toBe(200);
  const token = await tokenResponse.json();
  expect(token.access_token).toBeTruthy();
  expect(
    (
      await request('device/token', {
        client_id: 'senv-cli',
        device_code: code.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })
    ).status,
  ).toBe(400);
  const cliHeaders = new Headers({ authorization: `Bearer ${token.access_token}` });
  const browser = await auth.api.getSession({ headers: new Headers({ cookie }) });
  const terminal = await auth.api.getSession({ headers: cliHeaders });
  expect(terminal?.session.id).not.toBe(browser?.session.id);
  const { appRouter } = await import('../../../trpc/routers');
  const caller = appRouter.createCaller({
    req: new Request('http://localhost:3000/api/trpc', { headers: cliHeaders }),
  });
  expect(await caller.cli.access()).toMatchObject({
    kind: 'personal',
    sessionId: terminal!.session.id,
    impersonated: false,
  });
  const sessions = await caller.cli.sessions();
  expect(sessions.find((row) => row.current)).toMatchObject({
    kind: 'cli',
    label: 'Test terminal',
    version: '0.1.0',
  });
  expect(JSON.stringify(sessions)).not.toContain(token.access_token);
  await caller.cli.revokeSession({ id: terminal!.session.id });
  await expect(caller.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeTruthy();
});

test('automation credentials are hashed, project scoped, and cannot manage sessions or configuration', async () => {
  const cookie = await adminCookie();
  const { appRouter } = await import('../../../trpc/routers');
  const personal = appRouter.createCaller({
    req: new Request('http://localhost:3000/api/trpc', { headers: { cookie } }),
  });
  const project = await personal.projects.create({ name: 'Token project' });
  const token = await personal.cli.createToken({
    name: 'CI',
    projectId: project.id,
    permission: 'read',
  });
  const persisted = db.select().from(automationToken).where(eq(automationToken.id, token.id)).get();
  expect(JSON.stringify(persisted)).not.toContain(token.secret);
  const automation = appRouter.createCaller({
    req: new Request('http://localhost:3000/api/trpc', {
      headers: { authorization: `Bearer ${token.secret}` },
    }),
  });
  expect(await automation.cli.project({ project: project.previewSlug })).toMatchObject({
    id: project.id,
  });
  const access = await automation.cli.access();
  expect(access).toEqual({
    kind: 'automation',
    projectId: project.id,
    permission: 'read',
    impersonated: false,
    sessionId: null,
  });
  expect(JSON.stringify(access)).not.toContain(token.secret);
  expect(await automation.deployments.list({ projectId: project.id })).toHaveProperty(
    'deployments',
  );
  await expect(automation.cli.sessions()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(automation.projects.runtime({ projectId: project.id })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    automation.deployments.list({ projectId: 'different-project' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    automation.deployments.publish({
      projectId: project.id,
      kind: 'container',
      image: 'nginx:alpine',
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await personal.cli.revokeToken({ id: token.id });
  await expect(automation.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
});

test('explicit invalid credentials cannot fall back to a browser cookie, and bans are authoritative', async () => {
  const cookie = await adminCookie();
  const { resolvePrincipal } = await import('../services/request-principal');
  for (const authorization of ['Bearer invalid', 'Bearer a.b', ''])
    await expect(resolvePrincipal(new Headers({ cookie, authorization }))).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  const principal = await resolvePrincipal(new Headers({ cookie }));
  db.update(user).set({ banned: true }).where(eq(user.id, principal.user.id)).run();
  await expect(resolvePrincipal(new Headers({ cookie }))).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  expect(db.select().from(session).all().length).toBeGreaterThan(0);
});

test('password reset revokes automation tokens and outstanding approved device requests', async () => {
  const cookie = await adminCookie();
  const { appRouter } = await import('../../../trpc/routers');
  const personal = appRouter.createCaller({
    req: new Request('http://localhost:3000/api/trpc', { headers: { cookie } }),
  });
  const project = await personal.projects.create({ name: 'Reset project' });
  await personal.cli.createToken({ name: 'CI', permission: 'manage', projectId: project.id });
  const code = await (await request('device/code', { client_id: 'senv-cli' })).json();
  await request(`device?user_code=${code.user_code}`, undefined, undefined, { cookie });
  await request('device/approve', { userCode: code.user_code }, undefined, { cookie });
  expect((await request('account-password/self-reset', {}, undefined, { cookie })).status).toBe(
    200,
  );
  const message = email.getEmailNotifications().find((entry) => entry.to === credentials.email)!;
  const resetToken = new URL(
    message.text.match(/http:\/\/localhost:4200\/reset-password\?token=[A-Za-z0-9_-]+/)![0],
  ).searchParams.get('token');
  expect(
    (
      await request('account-password/complete', {
        token: resetToken,
        password: 'reset-cli-password',
      })
    ).status,
  ).toBe(200);
  expect(db.select().from(automationToken).all()).toHaveLength(0);
  expect(db.select().from(deviceCode).all()).toHaveLength(0);
  expect(
    (
      await request('device/token', {
        client_id: 'senv-cli',
        device_code: code.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })
    ).status,
  ).toBe(400);
});

test('revoked approval sessions and banned accounts cannot redeem approved device codes', async () => {
  const cookie = await adminCookie();
  const code = await (await request('device/code', { client_id: 'senv-cli' })).json();
  await request(`device?user_code=${code.user_code}`, undefined, undefined, { cookie });
  await request('device/approve', { userCode: code.user_code }, undefined, { cookie });
  const actor = await auth.api.getSession({ headers: new Headers({ cookie }) });
  db.delete(session).where(eq(session.id, actor!.session.id)).run();
  expect(
    (
      await request('device/token', {
        client_id: 'senv-cli',
        device_code: code.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })
    ).status,
  ).toBe(403);
});

test('automation tokens support no expiry, second-based lifetimes, and legacy defaults while enforcing revocation and expiry', async () => {
  const cookie = await adminCookie();
  const { appRouter } = await import('../../../trpc/routers');
  const personal = appRouter.createCaller({
    req: new Request('http://localhost:3000/api/trpc', { headers: { cookie } }),
  });
  const project = await personal.projects.create({ name: 'Expiry project' });
  const input = { name: 'CI', projectId: project.id, permission: 'read' as const };
  const before = Date.now();
  const defaults = await personal.cli.createToken(input);
  expect(defaults.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 30 * 86400 * 1000);
  const legacy = await personal.cli.createToken({ ...input, days: 365 });
  expect(legacy.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 365 * 86400 * 1000);
  const finite = await personal.cli.createToken({ ...input, expiresInSeconds: 60 });
  expect(finite.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  const infinite = await personal.cli.createToken({ ...input, expiresInSeconds: null });
  expect(infinite.expiresAt).toBeNull();
  expect(
    db.select().from(automationToken).where(eq(automationToken.id, infinite.id)).get()!.expiresAt,
  ).toBeNull();
  expect((await personal.cli.tokens()).find((row) => row.id === infinite.id)!.expiresAt).toBeNull();
  const caller = (secret: string) =>
    appRouter.createCaller({
      req: new Request('http://localhost:3000/api/trpc', {
        headers: { authorization: `Bearer ${secret}` },
      }),
    });
  expect(await caller(infinite.secret).cli.project({ project: project.id })).toMatchObject({
    id: project.id,
  });
  await personal.cli.revokeToken({ id: infinite.id });
  await expect(caller(infinite.secret).cli.access()).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  db.update(automationToken)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(automationToken.id, finite.id))
    .run();
  await expect(caller(finite.secret).cli.access()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  for (const seconds of [0, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
    await expect(
      personal.cli.createToken({ ...input, expiresInSeconds: seconds }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
  await expect(
    personal.cli.createToken({ ...input, days: 1, expiresInSeconds: null }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

test('browser auth responses keep tokens private and unsafe session endpoints are disabled', async () => {
  const cookie = await adminCookie();
  const internal = await auth.api.getSession({ headers: new Headers({ cookie }) });
  expect(internal?.session.token).toBeTruthy();
  const response = await request('get-session', undefined, undefined, { cookie });
  expect(response.headers.get('set-auth-token')).toBeNull();
  expect(JSON.stringify(await response.json())).not.toContain(internal!.session.token);
  for (const path of ['list-sessions', 'admin/list-user-sessions?userId=' + internal!.user.id]) {
    const response = await request(path, undefined, undefined, { cookie });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(internal!.session.token);
  }
  const invalid = await request('get-session', undefined, undefined, {
    cookie,
    authorization: 'Bearer a.b',
  });
  expect(await invalid.text()).not.toContain(internal!.user.email);
});

test('project IDs take precedence over legacy slug collisions, and new collisions are rejected', async () => {
  const cookie = await adminCookie();
  const { appRouter } = await import('../../../trpc/routers');
  const { organization } = await import('../../../../../../drizzle/schema');
  const caller = appRouter.createCaller({
    req: new Request('http://localhost:3000/api/trpc', { headers: { cookie } }),
  });
  const first = await caller.projects.create({ name: 'First' });
  const second = await caller.projects.create({ name: 'Second' });
  await expect(
    caller.projects.updatePreviewSlug({ projectId: first.id, previewSlug: second.id }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    caller.projects.create({ name: 'Collision', previewSlug: second.id }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  db.update(organization)
    .set({ previewSlug: second.id })
    .where(eq(organization.id, first.id))
    .run();
  expect(await caller.cli.project({ project: second.id })).toMatchObject({ id: second.id });
});

test('session revocation keeps the current session and session lists isolate accounts', async () => {
  const cookie = await adminCookie();
  const { appRouter } = await import('../../../trpc/routers');
  const caller = appRouter.createCaller({
    req: new Request('http://localhost:3000/api/trpc', { headers: { cookie } }),
  });
  const actor = await auth.api.getSession({ headers: new Headers({ cookie }) });
  db.insert(user).values({ id: 'other-user', name: 'Other', email: 'other@example.com' }).run();
  db.insert(session)
    .values([
      {
        id: 'foreign',
        token: 'foreign-secret',
        userId: 'other-user',
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: 'other-own',
        token: 'own-secret',
        userId: actor!.user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ])
    .run();
  expect((await caller.cli.sessions()).map((row) => row.id)).not.toContain('foreign');
  await expect(caller.cli.revokeSession({ id: 'foreign' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  await caller.cli.revokeOtherSessions();
  expect((await caller.cli.sessions()).map((row) => row.id)).toEqual([actor!.session.id]);
});

test('cookie mutations reject multipart bodies before dispatch and JSON mutations work', async () => {
  const cookie = await adminCookie();
  const { default: handler } = await import('../../../trpc/trpc-handler');
  const form = new FormData();
  const response = await handler.fetch(
    new Request('http://localhost:3000/api/trpc/cli.revokeOtherSessions', {
      method: 'POST',
      headers: { cookie, origin: 'http://preview.localhost' },
      body: form,
    }),
  );
  expect(response.status).toBe(415);
  const legitimate = await handler.fetch(
    new Request('http://localhost:3000/api/trpc/cli.revokeOtherSessions', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ json: null }),
    }),
  );
  expect(legitimate.status).toBe(200);
});

test('device lookup limits are enabled and both HTTP and tRPC entry points are bounded', async () => {
  const cookie = await adminCookie();
  expect(auth.options.rateLimit?.enabled).toBe(true);
  const { appRouter } = await import('../../../trpc/routers');
  const caller = appRouter.createCaller({
    req: new Request('http://localhost:3000/api/trpc', { headers: { cookie } }),
  });
  for (let i = 0; i < 20; i++)
    await expect(caller.cli.device({ userCode: 'UNKNOWN' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  await expect(caller.cli.device({ userCode: 'UNKNOWN' })).rejects.toMatchObject({
    code: 'TOO_MANY_REQUESTS',
  });
  for (let i = 0; i < 20; i++)
    await request('device?user_code=UNKNOWN', undefined, undefined, {
      cookie,
      'x-forwarded-for': '198.51.100.20',
    });
  expect(
    (
      await request('device?user_code=UNKNOWN', undefined, undefined, {
        cookie,
        'x-forwarded-for': '198.51.100.20',
      })
    ).status,
  ).toBe(429);
});

async function deviceApproval() {
  const cookie = await adminCookie();
  const code = await (await request('device/code', { client_id: 'senv-cli' })).json();
  expect(
    (await request(`device?user_code=${code.user_code}`, undefined, undefined, { cookie })).status,
  ).toBe(200);
  const redeem = () =>
    request('device/token', {
      client_id: 'senv-cli',
      device_code: code.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  return { cookie, code, redeem };
}

test('device requests reject client, scope and user bindings; pending polling slows down', async () => {
  for (const body of [
    { client_id: 'other' },
    { client_id: 'senv-cli', scope: '' },
    { client_id: 'senv-cli', scope: 'openid' },
    { client_id: 'senv-cli', user_id: 'admin' },
  ]) {
    const response = await request('device/code', body);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }
  const { redeem } = await deviceApproval();
  expect(await (await redeem()).json()).toMatchObject({ error: 'authorization_pending' });
  expect(await (await redeem()).json()).toMatchObject({ error: 'slow_down' });
});

test('denied and expired device requests cannot create CLI sessions', async () => {
  const { cookie, code, redeem } = await deviceApproval();
  expect(
    (await request('device/deny', { userCode: code.user_code }, undefined, { cookie })).status,
  ).toBe(200);
  expect(await (await redeem()).json()).toMatchObject({ error: 'access_denied' });
  const next = await (await request('device/code', { client_id: 'senv-cli' })).json();
  db.update(deviceCode)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(deviceCode.deviceCode, next.device_code))
    .run();
  expect(
    await (
      await request('device/token', {
        client_id: 'senv-cli',
        device_code: next.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      })
    ).json(),
  ).toMatchObject({ error: 'expired_token' });
});

test('approval is not overwritten and concurrent redemption issues just one CLI session', async () => {
  const { cookie, code, redeem } = await deviceApproval();
  expect(
    (await request('device/approve', { userCode: code.user_code }, undefined, { cookie })).status,
  ).toBe(200);
  const { cliDeviceRequest, cliSession } = await import('../../../../../../drizzle/schema');
  const recorded = db.select().from(cliDeviceRequest).get()!.approvingSessionId;
  const secondLogin = await request('sign-in/email', {
    email: credentials.email,
    password: credentials.password,
  });
  const secondCookie = secondLogin.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  await request('device/approve', { userCode: code.user_code }, undefined, {
    cookie: secondCookie,
  });
  expect(db.select().from(cliDeviceRequest).get()!.approvingSessionId).toBe(recorded);
  const responses = await Promise.all([redeem(), redeem()]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
  expect(db.select().from(cliSession).all()).toHaveLength(1);
});

for (const change of ['ban', 'delete', 'impersonate'] as const)
  test(`device redemption rejects an account changed after approval: ${change}`, async () => {
    const { cookie, code, redeem } = await deviceApproval();
    const actor = (await auth.api.getSession({ headers: new Headers({ cookie }) }))!;
    await request('device/approve', { userCode: code.user_code }, undefined, { cookie });
    if (change === 'ban')
      db.update(user).set({ banned: true }).where(eq(user.id, actor.user.id)).run();
    if (change === 'delete') db.delete(user).where(eq(user.id, actor.user.id)).run();
    if (change === 'impersonate')
      db.update(session)
        .set({ impersonatedBy: 'someone' })
        .where(eq(session.id, actor.session.id))
        .run();
    const response = await redeem();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    const { cliSession } = await import('../../../../../../drizzle/schema');
    expect(db.select().from(cliSession).all()).toHaveLength(0);
  });

test('personal CLI bearer sessions cannot invoke browser impersonation', async () => {
  const cookie = await adminCookie();
  const actor = (await auth.api.getSession({ headers: new Headers({ cookie }) }))!;
  const { cliSession } = await import('../../../../../../drizzle/schema');
  db.insert(user)
    .values({
      id: 'impersonation-target',
      name: 'Target',
      email: 'target@example.com',
      emailVerified: true,
    })
    .run();
  db.insert(cliSession)
    .values({ id: actor.session.id, label: 'CLI', version: 'test', lastActivityAt: new Date() })
    .run();
  const result = await request(
    'admin/impersonate-user',
    { userId: 'impersonation-target' },
    undefined,
    { authorization: `Bearer ${actor.session.token}` },
  );
  expect(result.status).toBe(403);
});

test('impersonated approval and pending accounts cannot authorize a CLI session', async () => {
  const { cookie, code } = await deviceApproval();
  const actor = (await auth.api.getSession({ headers: new Headers({ cookie }) }))!;
  db.update(session).set({ impersonatedBy: 'admin' }).where(eq(session.id, actor.session.id)).run();
  expect(
    (await request('device/approve', { userCode: code.user_code }, undefined, { cookie })).status,
  ).toBe(403);
  db.update(session).set({ impersonatedBy: null }).where(eq(session.id, actor.session.id)).run();
  const { account } = await import('../../../../../../drizzle/schema');
  db.delete(account).where(eq(account.userId, actor.user.id)).run();
  const { eligibleCliAccount } = await import('../services/cli-auth-options');
  expect(eligibleCliAccount(actor.user.id)).toBeNull();
  expect(
    (await request('device/approve', { userCode: code.user_code }, undefined, { cookie })).status,
  ).toBe(401);
});
