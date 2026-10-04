import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { deployment, deploymentSecret, deploymentTag } from '../../../../drizzle/schema.ts';
import { api, db, projectId, publishStatic } from './deployments.test-support.ts';

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

test('deployment reuse rejects cleanup-pending and cleaned source deployments', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '8'.repeat(64),
    size: 1,
    sha256: '8'.repeat(64),
  });
  const pending = await publishStatic({ artifactId: artifact.artifactId, secrets: {} });
  db.update(deployment)
    .set({ cleanupStartedAt: new Date(), cleanupAction: 'delete' })
    .where(eq(deployment.id, pending.id))
    .run();
  await expect(
    publishStatic({ artifactId: artifact.artifactId, reuseDeploymentId: pending.id, secrets: {} }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

  const cleaned = await publishStatic({ artifactId: artifact.artifactId, secrets: {} });
  db.update(deployment)
    .set({ cleanupStartedAt: null, status: 'cleaned' })
    .where(eq(deployment.id, cleaned.id))
    .run();
  await expect(
    publishStatic({ artifactId: artifact.artifactId, reuseDeploymentId: cleaned.id, secrets: {} }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

test('failed timed removal keeps durable intent, retires routes, and preserves deployment data', async () => {
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
  api.registerDeploymentRemovalHandler(async (_id, project) => {
    expect(project).toBe(projectId);
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
  expect(
    db.select().from(deploymentSecret).where(eq(deploymentSecret.deploymentId, target.id)).all(),
  ).toHaveLength(1);
  expect(
    db
      .select({ cleanupStartedAt: deployment.cleanupStartedAt })
      .from(deployment)
      .where(eq(deployment.id, target.id))
      .get()?.cleanupStartedAt,
  ).toBeInstanceOf(Date);
  expect(refreshes).toBe(1);
  api.registerDeploymentRemovalHandler(async () => {});
  await expect(api.resumePendingDeploymentRemovals()).resolves.toBe(1);
  expect(api.getProjectDeployment(projectId, target.id).status).toBe('cleaned');
  expect(refreshes).toBe(2);
  api.registerDeploymentRemovalHandler(async () => {});
  api.registerPreviewRoutesRefresh(async () => {});
});

test('one timed cleanup failure does not prevent other due deployments from completing', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '4'.repeat(64),
    size: 1,
    sha256: '4'.repeat(64),
  });
  const first = await publishStatic({ artifactId: artifact.artifactId });
  const second = await publishStatic({ artifactId: artifact.artifactId });
  await api.markDeploymentReady(first.id, new Date('2026-09-01T00:00:00Z'));
  await api.markDeploymentReady(second.id, new Date('2026-09-01T00:00:00Z'));
  api.registerDeploymentRemovalHandler(async (id) => {
    if (id === first.id) throw new Error('first remove failed');
  });
  await expect(api.cleanupDueDeployments(new Date('2026-10-01T00:00:00Z'))).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
  });
  expect(api.getProjectDeployment(projectId, first.id).status).toBe('healthy');
  expect(api.getProjectDeployment(projectId, second.id).status).toBe('cleaned');
  api.registerDeploymentRemovalHandler(async () => {});
});

test('route retirement failure before resource removal rolls back the new intent', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '2'.repeat(64),
    size: 1,
    sha256: '2'.repeat(64),
  });
  const target = await publishStatic({ artifactId: artifact.artifactId });
  await api.markDeploymentReady(target.id, new Date('2026-09-01T00:00:00Z'));
  let refreshes = 0;
  let removals = 0;
  api.registerPreviewRoutesRefresh(async () => {
    if (++refreshes === 1) throw new Error('route update failed');
  });
  api.registerDeploymentRemovalHandler(async () => {
    removals++;
  });
  await expect(api.cleanupDueDeployments(new Date('2026-10-01T00:00:00Z'))).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
  });
  expect(removals).toBe(0);
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
