import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { deployment, deploymentResourceSample } from '../../../../../../drizzle/schema';
import type { OriginResourceSample } from '../../../../shared/deployment-resources';
import { api, db, projectId } from './deployments.test-support';

const now = new Date('2026-10-04T09:00:15Z');
const available = (cpuPercent = 43.4): OriginResourceSample => ({
  status: 'available',
  sampledAt: now,
  cpuPercent,
  memoryUsedBytes: 268435456,
  memoryLimitBytes: 536870912,
});
const publish = () =>
  api.publishDeployment({
    projectId,
    kind: 'container',
    image: 'nginx:alpine',
    pinned: false,
    source: {},
    port: 80,
  });

test('returns 40 half-minute buckets across 20 minutes, preserving zero and gaps', async () => {
  const { getDeploymentResourceHistory } = await import('../services/resources');
  const target = await publish();
  api.recordDeploymentResourceSample(target.id, available(0), new Date('2026-10-04T08:41:12Z'));
  api.recordDeploymentResourceSample(target.id, available(200), new Date('2026-10-04T08:41:40Z'));
  api.recordDeploymentResourceSample(
    target.id,
    { status: 'unavailable', reason: 'container-stopped', sampledAt: now },
    new Date('2026-10-04T08:42:05Z'),
  );
  const history = getDeploymentResourceHistory(target.id, now);
  expect(history.from).toEqual(new Date('2026-10-04T08:40:15Z'));
  expect(history.to).toEqual(now);
  expect(history.intervalMs).toBe(30000);
  expect(history.points).toHaveLength(40);
  expect(
    history.points.filter((point) => point.cpuPercent !== null).map((point) => point.cpuPercent),
  ).toEqual([0, 200]);
  expect(
    history.points.find(
      (point) => point.sampledAt.getTime() === Date.parse('2026-10-04T08:42:00Z'),
    ),
  ).toMatchObject({ cpuPercent: null, memoryUsedBytes: null });
  expect(history.points[0].sampledAt).toEqual(new Date('2026-10-04T08:40:30Z'));
  expect(history.points.at(-1)?.sampledAt).toEqual(new Date('2026-10-04T09:00:00Z'));
});

test('upserts the latest sample in a bucket, prunes expired data, and survives new reads', async () => {
  const { getDeploymentResourceHistory } = await import('../services/resources');
  const target = await publish();
  const other = await publish();
  api.recordDeploymentResourceSample(target.id, available(10), new Date('2026-10-04T09:00:01Z'));
  api.recordDeploymentResourceSample(target.id, available(20), new Date('2026-10-04T09:00:14Z'));
  api.recordDeploymentResourceSample(target.id, available(99), new Date('2026-10-04T08:39:59Z'));
  api.recordDeploymentResourceSample(other.id, available(55), now);
  api.pruneDeploymentResourceSamples(now);
  expect(db.select().from(deploymentResourceSample).all()).toHaveLength(2);
  expect(getDeploymentResourceHistory(target.id, now).points.at(-1)?.cpuPercent).toBe(20);
  expect(getDeploymentResourceHistory(other.id, now).points.at(-1)?.cpuPercent).toBe(55);
});

test('does not record deleted deployments or deployments undergoing cleanup', async () => {
  const target = await publish();
  db.update(deployment).set({ cleanupStartedAt: now }).where(eq(deployment.id, target.id)).run();
  api.recordDeploymentResourceSample(target.id, available(), now);
  db.update(deployment)
    .set({ cleanupStartedAt: null, deletedAt: now })
    .where(eq(deployment.id, target.id))
    .run();
  api.recordDeploymentResourceSample(target.id, available(), now);
  api.recordDeploymentResourceSample('missing', available(), now);
  expect(db.select().from(deploymentResourceSample).all()).toHaveLength(0);
});
