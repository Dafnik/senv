import { expect, test } from 'vite-plus/test';
import { deploymentArtifact } from '../../../../drizzle/schema.ts';
import { publishDeploymentSchema } from '../../shared/deployments.ts';
import { api, caller, db, projectId, publishStatic } from './deployments.test-support.ts';

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
  expect(first.id).toMatch(/^[abcdefghjkmnopqrstuvwxy2345679]{12}$/);
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
