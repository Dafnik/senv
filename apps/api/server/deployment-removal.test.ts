import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { deployment, deploymentTag } from '../../../drizzle/schema';
import { api, db, projectId, publishStatic } from './deployments.test-support';

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
