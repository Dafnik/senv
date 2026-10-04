import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { deployment } from '../../../drizzle/schema';
import { api, db, developerId, projectId, publishStatic } from './deployments.test-support';

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
