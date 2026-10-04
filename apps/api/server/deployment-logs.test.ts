import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';
import { deployment } from '../../../drizzle/schema';

import { api, db, projectId, publishStatic } from './deployments.test-support';

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
