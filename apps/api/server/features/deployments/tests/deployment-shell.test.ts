import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, expect, test, vi } from 'vite-plus/test';
import { automationToken, deployment, session, user } from '../../../../../../drizzle/schema';
import { DockerEngine } from '../../../infrastructure/docker-engine';
import type { Principal } from '../../auth/services/request-principal';
import { deploymentInstanceId } from '../runtime/identity';
import { adminId, db, developerId, projectId, api, viewerId } from './deployments.test-support';

let consumeShellGrant: (typeof import('../services/shell'))['consumeShellGrant'];
let createShellGrant: (typeof import('../services/shell'))['createShellGrant'];
let inspectShellContainer: (typeof import('../services/shell'))['inspectShellContainer'];
let shellInput: (typeof import('../services/shell'))['shellInput'];
// Load database-backed code after the shared harness selects its temporary database.
beforeAll(async () => {
  ({ consumeShellGrant, createShellGrant, inspectShellContainer, shellInput } =
    await import('../services/shell'));
});

function principal(userId = developerId): Principal {
  const current = db
    .insert(session)
    .values({
      id: `session-${userId}`,
      token: `token-${userId}`,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning()
    .get()!;
  return {
    user: db.select().from(user).where(eq(user.id, userId)).get()!,
    session: current,
    automation: null,
  };
}
async function runningOrigin() {
  const row = await api.publishDeployment({
    projectId,
    kind: 'container',
    image: 'nginx:alpine',
    port: 80,
    pinned: false,
    source: {},
  });
  db.update(deployment).set({ status: 'healthy' }).where(eq(deployment.id, row.id)).run();
  const container = {
    Id: 'owned-physical-origin',
    State: { Running: true },
    Config: {
      Labels: {
        'senv.managed': 'true',
        'senv.instance': deploymentInstanceId(),
        'senv.project': projectId,
        'senv.deployment': row.id,
        'senv.role': 'origin',
      },
    },
  };
  const request = vi
    .spyOn(DockerEngine.prototype, 'request')
    .mockImplementation(async (_method, path) => ({
      status: 200,
      headers: {},
      body:
        path.startsWith('/containers/') && path.endsWith('/json')
          ? container
          : path.includes('/exec/') && path.endsWith('/json')
            ? { ExitCode: 0 }
            : { Id: 'probe-exec' },
    }));
  return { row, container, request, input: shellInput.parse({ projectId, deploymentId: row.id }) };
}
afterEach(() => vi.restoreAllMocks());

test('only a personal managing account can probe an origin; crafted container roles are rejected', async () => {
  const { input, request } = await runningOrigin();
  const viewer = principal(viewerId);
  await expect(inspectShellContainer(viewer, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const developer = principal();
  const token = db
    .insert(automationToken)
    .values({
      id: 'automation',
      tokenHash: 'hash',
      prefix: 'senv_at_',
      name: 'CI',
      userId: developerId,
      projectId,
      permission: 'manage',
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning()
    .get()!;
  await expect(
    inspectShellContainer({ ...developer, session: null, automation: token }, input),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    inspectShellContainer(
      { ...developer, session: { ...developer.session!, impersonatedBy: adminId } },
      input,
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(request).not.toHaveBeenCalled();
  expect(shellInput.safeParse({ ...input, containerRole: 'proxy' }).success).toBe(false);
  expect(shellInput.safeParse({ ...input, containerId: '/var/run/docker.sock' }).success).toBe(
    false,
  );
});

test('grants are single-use, session-bound, and cannot connect to a replaced container', async () => {
  const actor = principal();
  const { input, container } = await runningOrigin();
  const grant = await createShellGrant(actor, input);
  expect(await consumeShellGrant(actor, grant.grant)).toMatchObject({
    containerId: container.Id,
    executable: '/bin/sh',
    sessionId: actor.session!.id,
  });
  await expect(consumeShellGrant(actor, grant.grant)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const replaced = await createShellGrant(actor, input);
  container.Id = 'replacement-origin';
  await expect(consumeShellGrant(actor, replaced.grant)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  const bound = await createShellGrant(actor, input);
  const otherSession = { ...actor, session: { ...actor.session!, id: 'another-session' } };
  await expect(consumeShellGrant(otherSession, bound.grant)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
});

test('ownership labels and lifecycle are checked before any shell probe or connection', async () => {
  const actor = principal();
  const { input, container, request, row } = await runningOrigin();
  for (const [key, value] of [
    ['senv.role', 'proxy'],
    ['senv.instance', 'another-instance'],
    ['senv.project', 'another-project'],
    ['senv.deployment', 'another-deployment'],
  ] as const) {
    const original = container.Config.Labels[key];
    container.Config.Labels[key] = value;
    await expect(createShellGrant(actor, input)).rejects.toThrow('ownership labels');
    container.Config.Labels[key] = original;
  }
  expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  request.mockClear();
  db.update(deployment).set({ desiredState: 'stopped' }).where(eq(deployment.id, row.id)).run();
  await expect(createShellGrant(actor, input)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  expect(request).not.toHaveBeenCalled();
});
