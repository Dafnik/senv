import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import {
  deployment,
  deploymentHistory,
  deploymentLog,
  deploymentSecret,
} from '../../../drizzle/schema';

import { api, db, projectId, publishStatic } from './deployments.test-support';

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
