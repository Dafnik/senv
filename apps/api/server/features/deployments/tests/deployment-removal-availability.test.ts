import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { deployment } from '../../../../../../drizzle/schema.ts';
import { api, db, projectId, publishStatic } from './deployments.test-support.ts';

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
