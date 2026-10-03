import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import {
  deployment,
  deploymentArtifact,
  deploymentBranchAlias,
  deploymentHistory,
  deploymentLog,
  deploymentSecret,
  deploymentTag,
  member,
  organization,
  projectDeploymentSettings,
  user,
} from '../../../drizzle/schema';
import { deploymentSettingsSchema, publishDeploymentSchema } from '../shared/deployments';

let db: typeof import('./utils/db').db;
let api: typeof import('./utils/deployments');
let auth: typeof import('./utils/auth').auth;
let appRouter: typeof import('./trpc/routers').appRouter;
const directory = mkdtempSync(join(tmpdir(), 'senv-deployments-'));
const projectId = 'deployment-test-project';
const adminId = 'deployment-test-admin';
const developerId = 'deployment-test-developer';
const viewerId = 'deployment-test-viewer';

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', `file:${join(directory, 'deployments.sqlite')}`);
  vi.stubEnv('BETTER_AUTH_SECRET', 'deployment-tests-secret-at-least-32-characters');
  vi.stubEnv('ROOT_DOMAIN', 'localhost');
  vi.stubEnv('API_URL', 'http://localhost:3000');
  vi.stubEnv('APP_URL', 'http://localhost:4200');
  vi.stubEnv('NODE_ENV', 'test');
  ({ db } = await import('./utils/db'));
  migrate(db, { migrationsFolder: 'drizzle/migrations' });
  api = await import('./utils/deployments');
  ({ auth } = await import('./utils/auth'));
  ({ appRouter } = await import('./trpc/routers'));
});

beforeEach(() => {
  api.registerDeploymentRemovalHandler(async () => {});
  api.registerPreviewRoutesRefresh(async () => {});
  db.delete(organization).run();
  db.delete(user).run();
  db.insert(user)
    .values([
      { id: adminId, name: 'Instance admin', email: 'deployment-admin@example.com', role: 'admin' },
      { id: developerId, name: 'Developer', email: 'deployment-developer@example.com' },
      { id: viewerId, name: 'Viewer', email: 'deployment-viewer@example.com' },
    ])
    .run();
  db.insert(organization)
    .values({
      id: projectId,
      name: 'Deployment test',
      slug: projectId,
      previewSlug: 'deployment-test',
    })
    .run();
  db.insert(member)
    .values([
      {
        id: 'developer-membership',
        organizationId: projectId,
        userId: developerId,
        role: 'developer',
      },
      { id: 'viewer-membership', organizationId: projectId, userId: viewerId, role: 'viewer' },
    ])
    .run();
  db.insert(projectDeploymentSettings)
    .values({
      projectId,
      ...deploymentSettingsSchema.parse({}),
      repository: 'https://example.com/team/site.git',
    })
    .run();
});

afterAll(() => {
  db?.$client.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

async function publishStatic(overrides: Record<string, unknown> = {}) {
  api.updateProjectRuntime(projectId, {
    env: { PUBLIC_MODE: 'preview' },
    secrets: { API_TOKEN: 'never-return-this' },
  });
  return api.publishDeployment({
    projectId,
    kind: 'static',
    artifactId: 'static-artifact',
    pinned: false,
    source: {},
    port: 8080,

    ...overrides,
  } as Parameters<typeof api.publishDeployment>[0]);
}

async function caller(email: string, role?: 'admin') {
  const created = await auth.api.createUser({
    body: { name: email, email, password: 'deployment-caller-password' },
  });
  if (role) db.update(user).set({ role }).where(eq(user.id, created.user.id)).run();
  const login = await auth.api.signInEmail({
    body: { email, password: 'deployment-caller-password' },
    asResponse: true,
  });
  return {
    id: created.user.id,
    api: appRouter.createCaller({
      req: new Request('http://localhost:3000/api/trpc', {
        headers: new Headers({
          cookie: login.headers
            .getSetCookie()
            .map((cookie) => cookie.split(';')[0])
            .join(';'),
        }),
      }),
    }),
  };
}

test('deployment access distinguishes viewers, developers, and instance admins', () => {
  expect(() => api.assertProjectAccess(projectId, { id: viewerId }, true)).toThrowError();
  expect(api.assertProjectAccess(projectId, { id: developerId }, true).id).toBe(projectId);
  expect(api.assertProjectAccess(projectId, { id: adminId, role: 'admin' }, true).id).toBe(
    projectId,
  );
  expect(() => api.assertProjectAccess(projectId, { id: developerId }, false, true)).toThrowError();
});

test('authenticated API enforces viewer/developer/admin capabilities and redacts credentials', async () => {
  const viewer = await caller('api-viewer@example.com');
  const developer = await caller('api-developer@example.com');
  const instanceAdmin = await caller('api-instance-admin@example.com', 'admin');
  db.insert(member)
    .values([
      { id: 'api-viewer-membership', organizationId: projectId, userId: viewer.id, role: 'viewer' },
      {
        id: 'api-developer-membership',
        organizationId: projectId,
        userId: developer.id,
        role: 'developer',
      },
    ])
    .run();
  expect((await viewer.api.projects.deploymentSettings({ projectId })).repository).toBe(
    'https://example.com/team/site.git',
  );
  expect(
    (await viewer.api.projects.suggestPreviewSlug({ name: 'Deployment Test' })).previewSlug,
  ).toBe('deployment-test-2');
  await expect(
    viewer.api.deployments.publish({ projectId, kind: 'container', image: 'nginx:latest' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    viewer.api.projects.updateDeploymentSettings({
      projectId,
      settings: deploymentSettingsSchema.parse({}),
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await viewer.api.projects.runtime({ projectId })).toEqual({ env: {}, secretNames: [] });
  await expect(
    viewer.api.projects.updateRuntime({ projectId, runtime: { env: {}, secrets: {} } }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const runtime = await developer.api.projects.updateRuntime({
    projectId,
    runtime: { env: { MODE: 'preview' }, secrets: { TOKEN: 'hidden' } },
  });
  expect(runtime).toEqual({ env: { MODE: 'preview' }, secretNames: ['TOKEN'] });
  expect(await viewer.api.projects.runtime({ projectId })).toEqual(runtime);
  expect(JSON.stringify(await viewer.api.projects.runtime({ projectId }))).not.toContain('hidden');
  await expect(
    developer.api.projects.updatePreviewSlug({ projectId, previewSlug: 'changed' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const current = await developer.api.projects.deploymentSettings({ projectId });
  await developer.api.projects.updateDeploymentSettings({
    projectId,
    settings: {
      ...current,
      repository: 'https://example.com/team/updated.git',
      originCpus: '8',
      originMemoryBytes: 1073741824,
      retentionDays: 2,
    },
  });
  const updated = await developer.api.projects.deploymentSettings({ projectId });
  expect(updated.repository).toBe('https://example.com/team/updated.git');
  expect(updated.originCpus).toBe('1');
  expect(updated.originMemoryBytes).toBe(536870912);
  expect(updated.retentionDays).toBe(7);
  const changedSlug = await instanceAdmin.api.projects.updatePreviewSlug({
    projectId,
    previewSlug: 'changed-preview',
  });
  expect(changedSlug.previewSlug).toBe('changed-preview');
  const credential = await developer.api.deployments.saveRegistryCredential({
    projectId,
    name: 'private',
    registry: 'registry.example.com',
    username: 'builder',
    secret: 'private-password',
  });
  expect(JSON.stringify(credential)).not.toContain('private-password');
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'e'.repeat(64),
    size: 12,
    sha256: 'e'.repeat(64),
  });
  const published = await instanceAdmin.api.deployments.publish({
    projectId,
    kind: 'static',
    artifactId: artifact.artifactId,
    pinned: false,
    source: {},
    port: 80,
  });
  expect(published.status).toBe('queued');
  const preview = await import('./utils/deployment-preview-status');
  const previewRequest = vi.spyOn(preview, 'requestDeploymentPreview').mockResolvedValue({
    url: 'https://preview.example.test/',
    statusCode: 404,
    checkedAt: new Date(),
    responseTimeMs: 10,
    error: null,
  });
  try {
    expect(
      await viewer.api.deployments.previewStatus({ projectId, deploymentId: published.id }),
    ).toMatchObject({ statusCode: 404 });
    expect(previewRequest).toHaveBeenCalledWith(
      api.getProjectDeployment(projectId, published.id).previewUrl,
    );
    previewRequest.mockClear();
    db.insert(organization)
      .values({
        id: 'other-project',
        name: 'Other',
        slug: 'other-project',
        previewSlug: 'other-project',
      })
      .run();
    await expect(
      viewer.api.deployments.previewStatus({
        projectId: 'other-project',
        deploymentId: published.id,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      viewer.api.deployments.previewStatus({ projectId, deploymentId: 'missing-deployment' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(previewRequest).not.toHaveBeenCalled();
  } finally {
    previewRequest.mockRestore();
  }
  await expect(
    viewer.api.deployments.setPinned({ projectId, deploymentId: published.id, pinned: true }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(
    (
      await developer.api.deployments.setPinned({
        projectId,
        deploymentId: published.id,
        pinned: true,
      })
    ).pinned,
  ).toBe(true);
  api.appendDeploymentLog(published.id, 'origin', 'diagnostic output');
  expect(
    (await viewer.api.deployments.logs({ projectId, deploymentId: published.id, source: 'origin' }))
      .logs[0]?.content,
  ).toContain('diagnostic output');
  await expect(viewer.api.deployments.registryCredentials({ projectId })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    instanceAdmin.api.deployments.removeHistory({ projectId, deploymentId: published.id }),
  ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
});

test('container reuse preserves the resolved digest and captured registry auth after credential removal', async () => {
  const credentials = api.saveRegistryCredential({
    projectId,
    name: 'private registry',
    registry: 'registry.example.com',
    username: 'publisher',
    secret: 'registry-password',
  });
  const credential = credentials[0]!;
  api.updateProjectRuntime(projectId, { env: {}, secrets: { API_TOKEN: 'first-secret' } });
  const original = await api.publishDeployment({
    projectId,
    kind: 'container',
    image: 'registry.example.com/app:mutable',
    registryCredentialId: credential.id,
    pinned: true,
    source: {},
    port: 3000,
  });
  const digest = 'registry.example.com/app@sha256:' + 'f'.repeat(64);
  api.setDeploymentImageDigest(original.id, digest);
  api.deleteRegistryCredential(projectId, credential.id);
  api.updateProjectRuntime(projectId, { env: {}, secrets: { API_TOKEN: 'replacement-secret' } });
  const replacement = await api.publishDeployment({
    projectId,
    kind: 'container',
    reuseDeploymentId: original.id,
    pinned: false,
    source: {},
    port: 8080,
  });
  expect(replacement.imageDigest).toBe(digest);
  expect(api.getDeploymentRuntimeConfig(replacement.id)).toMatchObject({
    imageDigest: digest,
    registryAuth: {
      serverAddress: 'registry.example.com',
      username: 'publisher',
      password: 'registry-password',
    },
    secrets: { API_TOKEN: 'replacement-secret' },
  });
  expect(JSON.stringify(api.getProjectDeployment(projectId, replacement.id))).not.toContain(
    'registry-password',
  );
  db.insert(organization)
    .values({
      id: 'other-project',
      name: 'Other',
      slug: 'other-project',
      previewSlug: 'other-project',
    })
    .run();
  await expect(
    api.publishDeployment({
      projectId: 'other-project',
      kind: 'container',
      reuseDeploymentId: original.id,
      pinned: false,
      source: {},
      port: 80,
    }),
  ).rejects.toThrowError();
  await expect(
    api.publishDeployment({
      projectId: 'other-project',
      kind: 'static',
      artifactId: 'not-owned',
      pinned: false,
      source: {},
      port: 80,
    }),
  ).rejects.toThrowError();
});

test('publication captures immutable settings, redacts saved secrets, and supports artifact reuse', async () => {
  const artifactKey = 'a'.repeat(64);
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: artifactKey,
    size: 42,
    sha256: artifactKey,
  });
  expect(api.getArtifactCleanupState().pending).toContain(artifactKey);
  const first = await publishStatic({
    artifactId: artifact.artifactId,
    source: { commit: 'abc123', branch: 'main' },
  });
  api.updateProjectDeploymentSettings(projectId, {
    ...deploymentSettingsSchema.parse({}),
    repository: 'https://example.com/team/changed.git',
    repositoryProvider: 'gitlab',
    originCpus: '2',
    proxy: {
      routes: [
        {
          path: '/api',
          target: 'https://api.example.com',
          connectTimeoutSeconds: 10,
          readTimeoutSeconds: 60,
        },
      ],
      cacheRules: [],
      compression: { enabled: false, endings: [] },
    },
  });
  const publicValue = api.getProjectDeployment(projectId, first.id);
  expect(JSON.stringify(publicValue)).not.toContain('never-return-this');
  expect(publicValue.config.secretNames).toEqual(['API_TOKEN']);
  expect(publicValue.config.limits.origin.cpus).toBe('1');
  expect(publicValue.source.repository).toBe('https://example.com/team/site.git');
  expect(publicValue.source.repositoryProvider).toBe('github');
  expect(api.getProjectDeploymentSettings(projectId).repositoryProvider).toBe('gitlab');
  expect(publicValue.configurationChanges).toContain('Git provider');
  expect(api.getDeploymentRuntimeConfig(first.id)?.secrets).toEqual({
    API_TOKEN: 'never-return-this',
  });
  expect(() =>
    api.updateProjectDeploymentSettings(projectId, {
      ...deploymentSettingsSchema.parse({}),
      proxy: {
        routes: [
          {
            path: '/api',
            target: 'https://api.example.com',
            connectTimeoutSeconds: 10,
            readTimeoutSeconds: 60,
          },
          {
            path: '/api/',
            target: 'https://other.example.com',
            connectTimeoutSeconds: 10,
            readTimeoutSeconds: 60,
          },
        ],
        cacheRules: [],
        compression: { enabled: true, endings: [] },
      },
    }),
  ).toThrowError();
  expect(() =>
    deploymentSettingsSchema.parse({
      proxy: {
        routes: [
          {
            path: '/api',
            target: 'https://api.example.com;return 200',
            connectTimeoutSeconds: 10,
            readTimeoutSeconds: 60,
          },
        ],
      },
    }),
  ).toThrowError();
  const replacement = await publishStatic({ artifactId: artifact.artifactId, secrets: {} });
  expect(replacement.id).not.toBe(first.id);
  db.insert(organization)
    .values({
      id: 'shared-project',
      name: 'Shared project',
      slug: 'shared-project',
      previewSlug: 'shared-project',
    })
    .run();
  const sharedArtifact = api.registerUploadedArtifact({
    projectId: 'shared-project',
    kind: 'static',
    storageKey: artifactKey,
    size: 42,
    sha256: artifactKey,
  });
  const crossProjectReuse = await api.publishDeployment({
    projectId: 'shared-project',
    kind: 'static',
    artifactId: sharedArtifact.artifactId,
    pinned: false,
    source: {},
    port: 80,
  });
  expect(api.listReferencedArtifactStorageKeys()).toContain(artifactKey);
  expect(api.getArtifactCleanupState().referenced).toContain(artifactKey);
  await api.deleteDeployment(first.id);
  expect(api.listReferencedArtifactStorageKeys()).toContain(artifactKey);
  await api.deleteDeployment(replacement.id);
  expect(api.listReferencedArtifactStorageKeys()).toContain(artifactKey);
  await api.deleteDeployment(crossProjectReuse.id);
  expect(api.getArtifactCleanupState().released).toContain(artifactKey);
  expect(api.forgetArtifactStorageKey(artifactKey)).toBe(true);
  expect(
    db
      .select()
      .from(deploymentArtifact)
      .where(eq(deploymentArtifact.storageKey, artifactKey))
      .all(),
  ).toHaveLength(0);
});

test('branch selection follows submission order when readiness completes out of order', async () => {
  const artifactKey = 'b'.repeat(64);
  api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: artifactKey,
    size: 10,
    sha256: artifactKey,
  });
  const artifactId = db
    .select({ id: deploymentArtifact.id })
    .from(deploymentArtifact)
    .where(eq(deploymentArtifact.storageKey, artifactKey))
    .get()!.id;
  const earlier = await publishStatic({
    artifactId,
    source: { commit: 'earlier', branch: 'main' },
    secrets: {},
  });
  const later = await publishStatic({
    artifactId,
    source: { commit: 'later', branch: 'main' },
    secrets: {},
  });
  await api.markDeploymentReady(later.id, new Date('2026-10-03T12:00:00Z'));
  await api.markDeploymentReady(earlier.id, new Date('2026-10-03T12:01:00Z'));
  const alias = db
    .select()
    .from(deploymentBranchAlias)
    .where(
      and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.branch, 'main')),
    )
    .get();
  expect(alias?.deploymentId).toBe(later.id);
  expect(alias?.alias).toBe('br-main');
  expect(api.getProjectDeployment(projectId, later.id).retentionDeadlineAt).toBeNull();
  await api.deleteDeployment(later.id);
  const retired = db
    .select()
    .from(deploymentBranchAlias)
    .where(
      and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.branch, 'main')),
    )
    .get();
  expect(retired?.deploymentId).toBeNull();
  await api.markDeploymentReady(earlier.id, new Date('2026-10-03T12:02:00Z'));
  expect(
    db
      .select()
      .from(deploymentBranchAlias)
      .where(
        and(
          eq(deploymentBranchAlias.projectId, projectId),
          eq(deploymentBranchAlias.branch, 'main'),
        ),
      )
      .get()?.deploymentId,
  ).toBeNull();
  const next = await publishStatic({
    artifactId,
    source: { commit: 'next', branch: 'main' },
    secrets: {},
  });
  await api.markDeploymentReady(next.id);
  const restored = db
    .select()
    .from(deploymentBranchAlias)
    .where(
      and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.branch, 'main')),
    )
    .get();
  expect(restored?.alias).toBe('br-main');
  expect(restored?.deploymentId).toBe(next.id);
});

test('branch aliases normalize names without a suffix and reject collisions before publication', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '9'.repeat(64),
    size: 1,
    sha256: '9'.repeat(64),
  });
  const first = await publishStatic({
    artifactId: artifact.artifactId,
    source: { branch: 'feature/login' },
    secrets: {},
  });
  const second = await publishStatic({
    artifactId: artifact.artifactId,
    source: { branch: 'feature/login' },
    secrets: {},
  });
  await expect(
    publishStatic({
      artifactId: artifact.artifactId,
      source: { branch: 'feature-login' },
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    publishStatic({
      artifactId: artifact.artifactId,
      source: { branch: 'Feature/Login' },
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  const aliases = db
    .select()
    .from(deploymentBranchAlias)
    .where(eq(deploymentBranchAlias.projectId, projectId))
    .all();
  expect(aliases).toHaveLength(1);
  expect(aliases[0]?.alias).toBe('br-feature-login');
  expect(api.listProjectDeployments(projectId)).toHaveLength(2);
  expect(first.id).not.toBe(second.id);
});

test('normalized branch aliases remain DNS-safe for mixed case, separators, and long names', async () => {
  const { branchAlias } = await import('./utils/deployment-addresses');
  expect(branchAlias('Feature/Login__UI', projectId)).toBe('br-feature-login-ui');
  expect(branchAlias('main', projectId)).toBe('br-main');
  expect(branchAlias('a'.repeat(100), projectId)).toBe(`br-${'a'.repeat(60)}`);
  expect(branchAlias('a'.repeat(59) + '/long', projectId)).toBe(`br-${'a'.repeat(59)}`);
});

test('a stale readiness completion cannot turn a deliberately stopped deployment healthy', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'f'.repeat(64),
    size: 1,
    sha256: 'f'.repeat(64),
  });
  const target = await publishStatic({
    artifactId: artifact.artifactId,
    source: { branch: 'main' },
    secrets: {},
  });
  await api.markDeploymentReady(target.id);
  await api.stopDeployment(target.id);
  await api.markDeploymentReady(target.id);
  expect(api.getProjectDeployment(projectId, target.id)).toMatchObject({
    status: 'stopped',
    desiredState: 'stopped',
    branchAlias: 'br-main',
  });
  expect(api.getPreviewRouteTargets().deployments).not.toContainEqual(
    expect.objectContaining({ deploymentId: target.id }),
  );
  expect(api.getPreviewRouteTargets().branches).not.toContainEqual(
    expect.objectContaining({ deploymentId: target.id }),
  );
});

test('project slug validation reserves room for the longest deployment label in the full DNS name', async () => {
  // Both base-domain labels are valid DNS labels, but the complete 63 + 63 +
  // 63-character hostname would exceed DNS's 253-character limit.
  vi.stubEnv('PREVIEW_BASE_DOMAIN', `${'a'.repeat(63)}.${'b'.repeat(63)}`);
  await expect(api.updateProjectPreviewSlug(projectId, 's'.repeat(63))).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  vi.stubEnv('PREVIEW_BASE_DOMAIN', 'preview.localhost');
});

test('slug change rolls back the stored slug and republishes the previous routes when refresh fails', async () => {
  let calls = 0;
  api.registerPreviewRoutesRefresh(async () => {
    calls++;
    if (calls === 1) throw new Error('route file unavailable');
  });
  await expect(api.updateProjectPreviewSlug(projectId, 'new-preview')).rejects.toThrow(
    'rolled back',
  );
  expect(
    db
      .select({ previewSlug: organization.previewSlug })
      .from(organization)
      .where(eq(organization.id, projectId))
      .get()?.previewSlug,
  ).toBe('deployment-test');
  expect(calls).toBe(2);
  api.registerPreviewRoutesRefresh(async () => {});
});

test('deployment logs page through every retained row with a stable cursor', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '8'.repeat(64),
    size: 1,
    sha256: '8'.repeat(64),
  });
  const target = await publishStatic({ artifactId: artifact.artifactId, secrets: {} });
  for (let index = 0; index < 7; index++)
    api.appendDeploymentLog(target.id, 'origin', `line-${index}`);
  const first = api.getDeploymentLogs(target.id, 'origin', 3);
  const second = api.getDeploymentLogs(target.id, 'origin', 3, first.nextCursor!);
  const third = api.getDeploymentLogs(target.id, 'origin', 3, second.nextCursor!);
  expect(first.logs).toHaveLength(3);
  expect(second.logs).toHaveLength(3);
  expect(third.logs).toHaveLength(1);
  expect(third.nextCursor).toBeNull();
  expect([...first.logs, ...second.logs, ...third.logs].map((row) => row.content).sort()).toEqual(
    Array.from({ length: 7 }, (_, index) => `line-${index}`),
  );
});

test('deployment log ingestion keeps chunks below captured limits without an arbitrary 100KB cap', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '7'.repeat(64),
    size: 1,
    sha256: '7'.repeat(64),
  });
  const target = await publishStatic({ artifactId: artifact.artifactId, secrets: {} });
  const content = 'x'.repeat(110_000);
  api.appendDeploymentLog(target.id, 'origin', content);
  expect(api.getDeploymentLogs(target.id, 'origin', 1).logs[0]?.content).toBe(content);
});

test('cleanup intent prevents a new tag while runtime removal is in flight', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '6'.repeat(64),
    size: 1,
    sha256: '6'.repeat(64),
  });
  const target = await publishStatic({ artifactId: artifact.artifactId, secrets: {} });
  await api.markDeploymentReady(target.id, new Date('2026-09-01T00:00:00Z'));
  let enteredRemoval!: () => void;
  let finishRemoval!: () => void;
  api.registerDeploymentRemovalHandler(async () => {
    enteredRemoval();
    await new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
  });
  const cleanup = api.cleanupDueDeployments(new Date('2026-10-01T00:00:00Z'));
  await new Promise<void>((resolve) => {
    enteredRemoval = resolve;
  });
  expect(
    db
      .select({ cleanupStartedAt: deployment.cleanupStartedAt })
      .from(deployment)
      .where(eq(deployment.id, target.id))
      .get()?.cleanupStartedAt,
  ).toBeInstanceOf(Date);
  const tag = api.assignDeploymentTag(projectId, 'race-tag', target.id);
  finishRemoval();
  expect(await cleanup).toBe(1);
  await expect(tag).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  expect(
    db.select().from(deploymentTag).where(eq(deploymentTag.deploymentId, target.id)).all(),
  ).toHaveLength(0);
  api.registerDeploymentRemovalHandler(async () => {});
});

test('failed timed removal restores routes and preserves deployment data', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '5'.repeat(64),
    size: 1,
    sha256: '5'.repeat(64),
  });
  const target = await publishStatic({ artifactId: artifact.artifactId });
  await api.markDeploymentReady(target.id, new Date('2026-09-01T00:00:00Z'));
  let refreshes = 0;
  api.registerPreviewRoutesRefresh(async () => {
    refreshes++;
  });
  api.registerDeploymentRemovalHandler(async () => {
    throw new Error('docker remove failed');
  });
  await expect(api.cleanupDueDeployments(new Date('2026-10-01T00:00:00Z'))).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
  });
  expect(api.getProjectDeployment(projectId, target.id)).toMatchObject({
    status: 'healthy',
    desiredState: 'running',
    artifactId: artifact.artifactId,
  });
  expect(api.getDeploymentRuntimeConfig(target.id)?.secrets.API_TOKEN).toBe('never-return-this');
  expect(
    db
      .select({ cleanupStartedAt: deployment.cleanupStartedAt })
      .from(deployment)
      .where(eq(deployment.id, target.id))
      .get()?.cleanupStartedAt,
  ).toBeNull();
  expect(refreshes).toBe(2);
  api.registerDeploymentRemovalHandler(async () => {});
  api.registerPreviewRoutesRefresh(async () => {});
});

test('startup recovery finishes persisted clean and delete intents idempotently', async () => {
  const cases = [
    { action: 'clean' as const, key: '4'.repeat(64), expected: 'cleaned' },
    { action: 'delete' as const, key: '3'.repeat(64), expected: 'deleted' },
    { action: 'clean' as const, key: '2'.repeat(64), expected: 'cleaned' },
  ];
  const ids: string[] = [];
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index]!;
    const artifact = api.registerUploadedArtifact({
      projectId,
      kind: 'static',
      storageKey: item.key,
      size: 1,
      sha256: item.key,
    });
    const target = await publishStatic({ artifactId: artifact.artifactId, source: {} });
    await api.markDeploymentReady(target.id, new Date('2026-09-01T00:00:00Z'));
    db.update(deployment)
      .set({
        submittedAt: new Date(1000 + index),
        cleanupStartedAt: new Date('2026-10-01T00:00:00Z'),
        cleanupAction: item.action,
      })
      .where(eq(deployment.id, target.id))
      .run();
    expect(api.getDeploymentRuntimeConfig(target.id)).toBeNull();
    if (index === 0) {
      await expect(api.requestDeploymentStart(target.id)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
      await expect(api.stopDeployment(target.id)).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
      });
    }
    ids.push(target.id);
  }
  const removed: string[] = [];
  api.registerDeploymentRemovalHandler(async (deploymentId) => {
    if (deploymentId === ids[0]) throw new Error('first removal failed');
    removed.push(deploymentId);
  });
  await expect(api.resumePendingDeploymentRemovals()).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
  });
  expect(removed).toEqual([ids[1], ids[2]]);
  for (let index = 0; index < cases.length; index++) {
    const row = db.select().from(deployment).where(eq(deployment.id, ids[index]!)).get();
    expect(row?.cleanupStartedAt).toBeNull();
    expect(row?.cleanupAction).toBeNull();
    if (index === 0) {
      expect(row?.status).toBe('healthy');
      expect(row?.artifactId).toBeTruthy();
      expect(api.getDeploymentRuntimeConfig(ids[index]!)?.secrets.API_TOKEN).toBe(
        'never-return-this',
      );
    } else {
      expect(row?.status).toBe(cases[index]!.expected);
    }
    expect(api.listDeploymentHistory(projectId, 100, undefined, ids[index]).length).toBeGreaterThan(
      0,
    );
  }
  expect(await api.resumePendingDeploymentRemovals()).toBe(0);
  api.registerDeploymentRemovalHandler(async () => {});
});

test('tag protection starts a fresh retention clock when its last protection is removed', async () => {
  const artifactKey = 'c'.repeat(64);
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: artifactKey,
    size: 10,
    sha256: artifactKey,
  });
  const target = await publishStatic({ artifactId: artifact.artifactId, secrets: {} });
  const readyAt = new Date('2026-10-01T00:00:00Z');
  await api.markDeploymentReady(target.id, readyAt);
  expect(api.getProjectDeployment(projectId, target.id).retentionDeadlineAt?.getTime()).toBe(
    readyAt.getTime() + 7 * 86400000,
  );
  await api.assignDeploymentTag(projectId, 'stable', target.id);
  expect(api.getProjectDeployment(projectId, target.id).retentionDeadlineAt).toBeNull();
  await api.removeDeploymentTag(projectId, 'stable');
  const unprotected = api.getProjectDeployment(projectId, target.id);
  expect(unprotected.retentionStartedAt?.getTime()).toBeGreaterThan(readyAt.getTime());
  expect(unprotected.retentionDeadlineAt?.getTime()).toBe(
    unprotected.retentionStartedAt!.getTime() + 7 * 86400000,
  );
});

test('cleanup removes runtime secrets and artifacts while retaining removable history', async () => {
  const artifactKey = 'd'.repeat(64);
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: artifactKey,
    size: 10,
    sha256: artifactKey,
  });
  const target = await publishStatic({ artifactId: artifact.artifactId });
  await api.markDeploymentReady(target.id, new Date('2026-09-01T00:00:00Z'));
  const count = await api.cleanupDueDeployments(new Date('2026-10-01T00:00:00Z'));
  expect(count).toBe(1);
  expect(api.getDeploymentRuntimeConfig(target.id)).toBeNull();
  expect(
    db.select().from(deploymentSecret).where(eq(deploymentSecret.deploymentId, target.id)).get(),
  ).toBeUndefined();
  expect(api.getProjectDeployment(projectId, target.id).status).toBe('cleaned');
  expect(api.listDeploymentHistory(projectId, 100, undefined, target.id).length).toBeGreaterThan(0);
  api.appendDeploymentLog(target.id, 'origin', 'late callback');
  expect(
    db.select().from(deploymentLog).where(eq(deploymentLog.deploymentId, target.id)).all(),
  ).toHaveLength(0);
  api.removeDeploymentHistory(projectId, target.id);
  expect(db.select().from(deployment).where(eq(deployment.id, target.id)).get()).toBeUndefined();
  expect(
    db.select().from(deploymentHistory).where(eq(deploymentHistory.deploymentId, target.id)).all(),
  ).toHaveLength(0);
});

test('project runtime values are encrypted, hidden in responses, and captured at publication', async () => {
  api.updateProjectRuntime(projectId, {
    env: { MODE: 'first' },
    secrets: { TOKEN: 'project-secret' },
  });
  expect(
    publishDeploymentSchema.safeParse({
      projectId,
      kind: 'container',
      image: 'nginx:latest',
      env: { MODE: 'override' },
    }).success,
  ).toBe(false);
  const publicRuntime = api.getProjectRuntime(projectId);
  expect(publicRuntime).toEqual({ env: { MODE: 'first' }, secretNames: ['TOKEN'] });
  expect(JSON.stringify(publicRuntime)).not.toContain('project-secret');
  expect(
    db.$client
      .prepare('SELECT secretsCiphertext FROM projectDeploymentRuntime WHERE projectId = ?')
      .get(projectId),
  ).not.toEqual(
    expect.objectContaining({ secretsCiphertext: expect.stringContaining('project-secret') }),
  );
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '9'.repeat(64),
    size: 12,
    sha256: '9'.repeat(64),
  });
  const first = await api.publishDeployment({
    projectId,
    kind: 'static',
    artifactId: artifact.artifactId,
    pinned: false,
    source: {},
    port: 80,
  });
  expect(api.getDeploymentRuntimeConfig(first.id)).toMatchObject({
    env: { MODE: 'first' },
    secrets: { TOKEN: 'project-secret' },
  });
  api.updateProjectRuntime(projectId, {
    env: { MODE: 'second' },
    secrets: {},
    removeSecretNames: ['TOKEN'],
  });
  const second = await api.publishDeployment({
    projectId,
    kind: 'static',
    reuseDeploymentId: first.id,
    pinned: false,
    source: {},
    port: 80,
  });
  expect(api.getDeploymentRuntimeConfig(second.id)).toMatchObject({
    env: { MODE: 'second' },
    secrets: {},
  });
  expect(api.getDeploymentRuntimeConfig(first.id)).toMatchObject({
    env: { MODE: 'first' },
    secrets: { TOKEN: 'project-secret' },
  });
  api.updateProjectRuntime(projectId, { env: {}, secrets: { TOKEN: 'preserved' } });
  expect(() =>
    api.updateProjectRuntime(projectId, { env: { TOKEN: 'duplicate' }, secrets: {} }),
  ).toThrow('already used');
  expect(api.getProjectRuntime(projectId).secretNames).toEqual(['TOKEN']);
});

test('pinning prevents timed cleanup and unpinning starts a fresh retention period', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '8'.repeat(64),
    size: 12,
    sha256: '8'.repeat(64),
  });
  const target = await publishStatic({ artifactId: artifact.artifactId, pinned: true });
  await api.markDeploymentReady(target.id);
  expect(api.getProjectDeployment(projectId, target.id)).toMatchObject({
    pinned: true,
    retentionDeadlineAt: null,
  });
  await api.cleanupDueDeployments(new Date(Date.now() + 366 * 86400000));
  expect(api.getProjectDeployment(projectId, target.id).status).toBe('healthy');
  api.setDeploymentPinned(projectId, target.id, false);
  const unpinned = api.getProjectDeployment(projectId, target.id);
  expect(unpinned.pinned).toBe(false);
  expect(unpinned.retentionDeadlineAt!.getTime()).toBe(
    unpinned.retentionStartedAt!.getTime() + 7 * 86400000,
  );
  await api.assignDeploymentTag(projectId, 'stable', target.id);
  api.setDeploymentPinned(projectId, target.id, true);
  api.setDeploymentPinned(projectId, target.id, false);
  expect(api.getProjectDeployment(projectId, target.id).retentionDeadlineAt).toBeNull();
});

test('unpinning a failed deployment starts retention even when it never became ready', async () => {
  const target = await api.publishDeployment({
    projectId,
    kind: 'container',
    image: 'nginx:latest',
    pinned: true,
    source: {},
    port: 80,
  });
  await api.markDeploymentFailed(target.id, 'Startup failed');
  expect(api.getProjectDeployment(projectId, target.id).retentionDeadlineAt).toBeNull();
  api.setDeploymentPinned(projectId, target.id, false);
  expect(api.getProjectDeployment(projectId, target.id).retentionDeadlineAt).not.toBeNull();
});

test('project routing is captured at publication and deployment overrides are rejected', async () => {
  api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'a'.repeat(64),
    sha256: 'a'.repeat(64),
    size: 20,
  });
  const artifact = db.select().from(deploymentArtifact).get()!;
  api.updateProjectDeploymentSettings(projectId, {
    ...api.getProjectDeploymentSettings(projectId),
    spaFallback: true,
  });
  const first = await publishStatic({ artifactId: artifact.id });
  expect(first.id).toMatch(/^[acdefghjkmnpqrtuvwxy34679]{6}$/);
  expect(first.config.spaFallback).toBe(true);
  api.updateProjectDeploymentSettings(projectId, {
    ...api.getProjectDeploymentSettings(projectId),
    spaFallback: false,
  });
  const second = await publishStatic({ reuseDeploymentId: first.id });
  expect(second.id).not.toBe(first.id);
  expect(second.config.spaFallback).toBe(false);
  expect(api.getProjectDeployment(projectId, first.id).config.spaFallback).toBe(true);
  expect(
    publishDeploymentSchema.safeParse({
      projectId,
      kind: 'static',
      artifactId: artifact.id,
      spaFallback: true,
    }).success,
  ).toBe(false);
  await api.markDeploymentReady(first.id);
  await expect(api.assignDeploymentTag(projectId, second.id, first.id)).rejects.toThrow(
    'Tag names cannot match a deployment ID',
  );
});

test('authenticated actions record actor snapshots while runtime events identify the system', async () => {
  const actor = await caller('audit-admin@example.com', 'admin');
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'b'.repeat(64),
    sha256: 'b'.repeat(64),
    size: 20,
  });
  const result = await actor.api.deployments.publish({
    projectId,
    kind: 'static',
    artifactId: artifact.artifactId,
    pinned: false,
    source: {},
    port: 80,
  });
  await api.markDeploymentReady(result.id);
  await actor.api.deployments.setPinned({ projectId, deploymentId: result.id, pinned: true });
  await actor.api.deployments.stop({ projectId, deploymentId: result.id });
  await actor.api.deployments.restart({ projectId, deploymentId: result.id });
  await actor.api.deployments.delete({ projectId, deploymentId: result.id });
  db.update(user).set({ name: 'Renamed account' }).where(eq(user.id, actor.id)).run();
  const entries = await actor.api.deployments.history({ projectId });
  for (const action of ['submitted', 'pinned', 'stopped', 'restart-requested', 'deleted']) {
    const entry = entries.find((entry) => entry.event === action)!;
    expect(entry.actorType).toBe('user');
    expect(entry.actor).toEqual({ id: actor.id, name: 'audit-admin@example.com' });
  }
  expect(entries.find((entry) => entry.event === 'healthy')).toMatchObject({
    actorType: 'system',
    actor: null,
  });
});

test('resuming a pending deletion preserves the user who requested it', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'c'.repeat(64),
    sha256: 'c'.repeat(64),
    size: 20,
  });
  const result = await publishStatic({ artifactId: artifact.artifactId });
  db.update(deployment)
    .set({
      cleanupStartedAt: new Date(),
      cleanupAction: 'delete',
      cleanupActor: { id: developerId, name: 'Developer' },
    })
    .where(eq(deployment.id, result.id))
    .run();
  await api.resumePendingDeploymentRemovals();
  expect(
    api.listDeploymentHistory(projectId).find((entry) => entry.event === 'deleted'),
  ).toMatchObject({ actorType: 'user', actor: { id: developerId, name: 'Developer' } });
});

test('configuration freshness compares current settings and runtime values without exposing secret fingerprints', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'd'.repeat(64),
    sha256: 'd'.repeat(64),
    size: 20,
  });
  const originalSettings = api.getProjectDeploymentSettings(projectId);
  const result = await publishStatic({ artifactId: artifact.artifactId });
  expect(result.configurationOutdated).toBe(false);
  api.updateProjectDeploymentSettings(projectId, {
    ...originalSettings,
    health: { ...originalSettings.health, path: '/health' },
    originCpus: '2',
    spaFallback: !originalSettings.spaFallback,
  });
  const changed = api.getProjectDeployment(projectId, result.id);
  expect(changed.configurationOutdated).toBe(true);
  expect(changed.configurationChanges).toEqual(
    expect.arrayContaining(['Health checks', 'Origin resources', 'Client-side routing']),
  );
  api.updateProjectDeploymentSettings(projectId, originalSettings);
  api.updateProjectRuntime(projectId, {
    env: { PUBLIC_MODE: 'preview' },
    secrets: { API_TOKEN: 'new-secret-value' },
  });
  expect(api.getProjectDeployment(projectId, result.id).configurationChanges).toEqual([
    'Runtime secrets',
  ]);
  await api.deleteDeployment(result.id);
  expect(api.getProjectDeployment(projectId, result.id).configurationChanges).toEqual([
    'Runtime secrets',
  ]);
  api.updateProjectRuntime(projectId, {
    env: { PUBLIC_MODE: 'preview' },
    secrets: { API_TOKEN: 'never-return-this' },
  });
  expect(api.getProjectDeployment(projectId, result.id).configurationOutdated).toBe(false);
  const publicJson = JSON.stringify(api.getProjectDeployment(projectId, result.id));
  expect(publicJson).not.toContain('runtimeFingerprint');
  expect(publicJson).not.toContain('never-return-this');
  expect(api.listProjectDeployments(projectId)[0]!.previewUrl).toContain(
    result.id + '.deployment-test.',
  );
});

test('project slug lookup requires access and old senv routes stop resolving after a change', async () => {
  const actor = await caller('slug-admin@example.com', 'admin');
  const outsider = await caller('slug-outsider@example.com');
  expect((await actor.api.projects.bySlug({ projectSlug: 'deployment-test' })).id).toBe(projectId);
  await expect(
    outsider.api.projects.bySlug({ projectSlug: 'deployment-test' }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await actor.api.projects.list({})).projects[0]!.previewSlug).toBe('deployment-test');
  await actor.api.projects.updatePreviewSlug({ projectId, previewSlug: 'renamed-project' });
  await expect(actor.api.projects.bySlug({ projectSlug: 'deployment-test' })).rejects.toMatchObject(
    { code: 'NOT_FOUND' },
  );
  await expect(actor.api.projects.bySlug({ projectSlug: projectId })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect((await actor.api.projects.bySlug({ projectSlug: 'renamed-project' })).id).toBe(projectId);
});

test('retention settings affect new snapshots without changing existing expiry dates or unpin policy', async () => {
  const first = await api.publishDeployment({
    projectId,
    kind: 'container',
    pinned: false,
    image: 'nginx:latest',
    source: {},
    port: 80,
  });
  await api.markDeploymentReady(first.id);
  const original = api.getProjectDeployment(projectId, first.id);
  expect(original.config.retentionDays).toBe(7);
  api.updateProjectDeploymentSettings(projectId, {
    ...api.getProjectDeploymentSettings(projectId),
    retentionDays: 2,
  });
  const current = api.getProjectDeployment(projectId, first.id);
  expect(current.retentionDeadlineAt).toEqual(original.retentionDeadlineAt);
  expect(current.configurationChanges).toContain('Deployment retention');
  api.setDeploymentPinned(projectId, first.id, true);
  api.setDeploymentPinned(projectId, first.id, false);
  const unpinned = api.getProjectDeployment(projectId, first.id);
  expect(unpinned.retentionDeadlineAt!.getTime() - unpinned.retentionStartedAt!.getTime()).toBe(
    7 * 86400000,
  );
  const second = await api.publishDeployment({
    projectId,
    kind: 'container',
    pinned: false,
    image: 'nginx:latest',
    source: {},
    port: 80,
  });
  await api.markDeploymentReady(second.id);
  const newer = api.getProjectDeployment(projectId, second.id);
  expect(newer.config.retentionDays).toBe(2);
  expect(newer.retentionDeadlineAt!.getTime() - newer.retentionStartedAt!.getTime()).toBe(
    2 * 86400000,
  );
  expect(newer.configurationOutdated).toBe(false);
});

test('log ordering, pagination, and eviction follow append order within one millisecond', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'a'.repeat(64),
    sha256: 'a'.repeat(64),
    size: 1,
  });
  const target = await publishStatic({ artifactId: artifact.artifactId });
  db.update(deployment)
    .set({
      snapshot: {
        ...db.select().from(deployment).where(eq(deployment.id, target.id)).get()!.snapshot,
        logs: { files: 1, fileSizeBytes: 1024 },
      },
    })
    .where(eq(deployment.id, target.id))
    .run();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    const batches = Array.from(
      { length: 20 },
      (_, i) => String(i).padStart(3, '0') + 'x'.repeat(97),
    );
    for (const batch of batches) api.appendDeploymentLog(target.id, 'origin', batch);
    const first = api.getDeploymentLogs(target.id, 'origin', 6);
    const second = api.getDeploymentLogs(target.id, 'origin', 6, first.nextCursor!);
    expect([...second.logs, ...first.logs].map((row) => row.content)).toEqual(batches.slice(10));
    expect(second.nextCursor).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test('invalid rewrites and equivalent proxy matchers preserve previous project defaults', () => {
  const previous = api.getProjectDeploymentSettings(projectId);
  const route = {
    path: '/api',
    target: 'http://example.com',
    connectTimeoutSeconds: 10,
    readTimeoutSeconds: 60,
  };
  for (const rewrite of ['/../', '//', '/a//b', '/./']) {
    expect(() =>
      api.updateProjectDeploymentSettings(projectId, {
        ...previous,
        proxy: { ...previous.proxy, routes: [{ ...route, rewrite }] },
      }),
    ).toThrow();
    expect(api.getProjectDeploymentSettings(projectId)).toEqual(previous);
  }
  for (const proxy of [
    { ...previous.proxy, routes: [route, { ...route, path: '/api/' }] },
    {
      ...previous.proxy,
      cacheRules: [
        { matcher: 'extension', value: 'js', durationSeconds: 60 },
        { matcher: 'extension', value: '.JS', durationSeconds: 60 },
      ],
    },
    {
      ...previous.proxy,
      cacheRules: [
        { matcher: 'path', value: '/assets', durationSeconds: 60 },
        { matcher: 'path', value: '/assets/', durationSeconds: 60 },
      ],
    },
  ]) {
    expect(() => api.updateProjectDeploymentSettings(projectId, { ...previous, proxy })).toThrow();
    expect(api.getProjectDeploymentSettings(projectId)).toEqual(previous);
  }
});

test('all removal entry points require an available runtime before releasing retained data', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'b'.repeat(64),
    sha256: 'b'.repeat(64),
    size: 1,
  });
  const target = await publishStatic({ artifactId: artifact.artifactId });
  await api.markDeploymentReady(target.id, new Date('2026-09-01T00:00:00Z'));
  api.registerDeploymentRemovalHandler();
  await expect(api.deleteDeployment(target.id)).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  await expect(api.cleanupDueDeployments(new Date('2026-10-03T00:00:00Z'))).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  expect(api.getProjectDeployment(projectId, target.id)).toMatchObject({
    status: 'healthy',
    artifactId: artifact.artifactId,
    removalPending: false,
  });
  db.update(deployment)
    .set({ cleanupStartedAt: new Date(), cleanupAction: 'delete' })
    .where(eq(deployment.id, target.id))
    .run();
  await expect(api.resumePendingDeploymentRemovals()).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  expect(api.getProjectDeployment(projectId, target.id)).toMatchObject({
    status: 'healthy',
    artifactId: artifact.artifactId,
    removalPending: true,
  });
});
