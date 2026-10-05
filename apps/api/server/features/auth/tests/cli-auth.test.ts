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
  await expect(
    resolvePrincipal(new Headers({ cookie, authorization: 'Bearer invalid' })),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
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
