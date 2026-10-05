import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';
import { member, organization } from '../../../../../../drizzle/schema.ts';
import { DockerEngine, type DockerResponse } from '../../../infrastructure/docker-engine.ts';
import { deploymentInstanceId } from '../runtime/identity.ts';
import {
  adminId,
  api,
  caller,
  db,
  developerId,
  projectId,
  publishStatic,
  viewerId,
} from './deployments.test-support.ts';

test('project access permissions distinguish readers, managers, and admins', () => {
  const read = (id: string, role?: string) =>
    api.assertProjectAccess(projectId, { id, role }, 'read');
  const manage = (id: string, role?: string) =>
    api.assertProjectAccess(projectId, { id, role }, 'manage');
  const admin = (id: string, role?: string) =>
    api.assertProjectAccess(projectId, { id, role }, 'admin');

  expect(read(viewerId).id).toBe(projectId);
  expect(() => manage(viewerId)).toThrowError();
  expect(() => admin(viewerId)).toThrowError();
  expect(read(developerId).id).toBe(projectId);
  expect(manage(developerId).id).toBe(projectId);
  expect(() => admin(developerId)).toThrowError();
  expect(read(adminId, 'admin').id).toBe(projectId);
  expect(manage(adminId, 'admin').id).toBe(projectId);
  expect(admin(adminId, 'admin').id).toBe(projectId);

  db.update(member).set({ role: 'admin' }).where(eq(member.userId, viewerId)).run();
  expect(admin(viewerId).id).toBe(projectId);
  db.update(member).set({ role: 'legacy' }).where(eq(member.userId, viewerId)).run();
  expect(manage(viewerId).id).toBe(projectId);
  expect(() => admin(viewerId)).toThrowError();
  db.update(member).set({ role: 'viewer' }).where(eq(member.userId, viewerId)).run();

  expect(() => read('outsider')).toThrowError();
  expect(() => api.assertProjectAccess('missing-project', { id: adminId }, 'read')).toThrowError(
    'Project not found.',
  );
});

test('resource samples allow project readers and reject callers outside the deployment project', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'd'.repeat(64),
    size: 1,
    sha256: 'd'.repeat(64),
  });
  const published = await publishStatic({ artifactId: artifact.artifactId });
  const foreignProjectId = 'resource-foreign-project';
  db.insert(organization)
    .values({
      id: foreignProjectId,
      name: 'Foreign project',
      slug: foreignProjectId,
      previewSlug: foreignProjectId,
    })
    .run();
  const foreignDeployment = await api.publishDeployment({
    projectId: foreignProjectId,
    kind: 'container',
    image: 'nginx:latest',
    pinned: false,
    source: {},
    port: 80,
  });
  const viewer = await caller('resource-viewer@example.com');
  db.insert(member)
    .values({
      id: 'resource-viewer-membership',
      organizationId: projectId,
      userId: viewer.id,
      role: 'viewer',
    })
    .run();

  const requests: string[] = [];
  const docker = vi
    .spyOn(DockerEngine.prototype, 'request')
    .mockImplementation(
      async <T = unknown>(_method: string, path: string): Promise<DockerResponse<T>> => {
        requests.push(path);
        const body = path.endsWith('/json')
          ? {
              Id: 'origin-resource-test',
              State: { Running: true },
              Config: {
                Labels: {
                  'senv.managed': 'true',
                  'senv.instance': deploymentInstanceId(),
                  'senv.deployment': published.id,
                  'senv.project': projectId,
                  'senv.role': 'origin',
                },
              },
            }
          : {
              cpu_stats: {
                cpu_usage: { total_usage: 20 },
                system_cpu_usage: 100,
                online_cpus: 2,
              },
              precpu_stats: { cpu_usage: { total_usage: 10 }, system_cpu_usage: 80 },
              memory_stats: { usage: 50, limit: 100 },
            };
        return { status: 200, headers: {}, body: body as T };
      },
    );
  try {
    const sample = await viewer.api.deployments.resources({
      projectId,
      deploymentId: published.id,
    });
    expect(sample.status).toBe('available');
    api.recordDeploymentResourceSample(published.id, sample);
    const history = await viewer.api.deployments.resourceHistory({
      projectId,
      deploymentId: published.id,
    });
    expect(history.points).toHaveLength(40);
    expect(history.points.at(-1)?.cpuPercent).toBe(100);
    expect(requests).toHaveLength(2);

    const outsider = await caller('resource-outsider@example.com');
    await expect(
      outsider.api.deployments.resources({ projectId, deploymentId: published.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      viewer.api.deployments.resources({ projectId, deploymentId: foreignDeployment.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      outsider.api.deployments.resourceHistory({ projectId, deploymentId: published.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      viewer.api.deployments.resourceHistory({ projectId, deploymentId: foreignDeployment.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(requests).toHaveLength(2);
  } finally {
    docker.mockRestore();
  }
});

test('deployment audit authorization checks project membership and scoped deployment identity', async () => {
  const target = await api.publishDeployment({
    projectId,
    kind: 'container',
    image: 'nginx:latest',
    pinned: false,
    source: {},
    port: 80,
  });
  const viewer = await caller('audit-reader@example.com');
  db.insert(member)
    .values({
      id: 'audit-reader-membership',
      organizationId: projectId,
      userId: viewer.id,
      role: 'viewer',
    })
    .run();
  const outsider = await caller('audit-outsider@example.com');
  expect((await viewer.api.deployments.audit({ projectId })).total).toBe(1);
  await expect(outsider.api.deployments.audit({ projectId })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    viewer.api.deployments.audit({ projectId, deploymentId: 'missing-deployment' }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    viewer.api.deployments.audit({ projectId: 'missing-project' }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect((await viewer.api.deployments.audit({ projectId, deploymentId: target.id })).total).toBe(
    1,
  );

  db.insert(organization)
    .values({
      id: 'audit-foreign-project',
      name: 'Foreign',
      slug: 'audit-foreign',
      previewSlug: 'audit-foreign',
    })
    .run();
  const foreignTarget = await api.publishDeployment({
    projectId: 'audit-foreign-project',
    kind: 'container',
    image: 'nginx:latest',
    pinned: false,
    source: {},
    port: 80,
  });
  await expect(
    viewer.api.deployments.audit({ projectId, deploymentId: foreignTarget.id }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
});
