import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { user } from '../../../drizzle/schema';
import { api, caller, db, projectId } from './deployments.test-support';

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
