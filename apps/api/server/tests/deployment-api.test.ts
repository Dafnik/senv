import { expect, test, vi } from 'vite-plus/test';
import { member, organization } from '../../../../drizzle/schema.ts';
import { deploymentSettingsSchema } from '../../shared/deployments.ts';
import { api, caller, db, projectId } from './deployments.test-support.ts';

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
  const preview = await import('../utils/deployment-preview-status.ts');
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
