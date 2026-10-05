import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { deployment, deploymentSecret } from '../../../../../../drizzle/schema.ts';
import { api, db, developerId, projectId, publishStatic } from './deployments.test-support.ts';

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
    if (index === 0) {
      expect(row?.cleanupStartedAt).toBeInstanceOf(Date);
      expect(row?.cleanupAction).toBe('clean');
      expect(row?.status).toBe('healthy');
      expect(row?.artifactId).toBeTruthy();
      expect(
        db
          .select()
          .from(deploymentSecret)
          .where(eq(deploymentSecret.deploymentId, ids[index]!))
          .all(),
      ).toHaveLength(1);
    } else {
      expect(row?.cleanupStartedAt).toBeNull();
      expect(row?.cleanupAction).toBeNull();
      expect(row?.status).toBe(cases[index]!.expected);
    }
    expect(api.listDeploymentHistory(projectId, 100, undefined, ids[index]).length).toBeGreaterThan(
      0,
    );
  }
  api.registerDeploymentRemovalHandler(async () => {});
  expect(await api.resumePendingDeploymentRemovals()).toBe(1);
  expect(
    db.select().from(deployment).where(eq(deployment.id, ids[0]!)).get()?.cleanupStartedAt,
  ).toBeNull();
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
