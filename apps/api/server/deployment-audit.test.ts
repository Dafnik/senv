import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { deploymentHistory, member, organization, user } from '../../../drizzle/schema';
import { api, caller, db, projectId } from './deployments.test-support';
test('deployment audit filters, searches, sorts, and pages snapshot history', async () => {
  const target = await api.publishDeployment({
    projectId,
    kind: 'container',
    image: 'nginx:latest',
    pinned: false,
    source: {},
    port: 80,
  });
  const snapshotUserId = 'deleted-audit-user';
  db.insert(user)
    .values({ id: snapshotUserId, name: 'Before deletion', email: 'audit@example.com' })
    .run();
  const rows = Array.from({ length: 105 }, (_, index) => ({
    id: `audit-${String(index).padStart(3, '0')}`,
    projectId,
    deploymentId: index === 0 ? target.id : `dpl-${index}`,
    event: index % 2 === 0 ? 'published' : 'failed',
    actorType: index === 0 || index % 10 === 0 ? ('system' as const) : ('user' as const),
    actor:
      index === 0 || index % 10 === 0
        ? null
        : { id: `deleted-audit-${index}`, name: `Historical actor ${index}` },
    details: { message: `audit detail ${index}` },
    createdAt: new Date(1_000 + index),
  }));
  rows[0]!.actorType = 'user';
  rows[0]!.actor = { id: snapshotUserId, name: 'Before deletion' };
  db.insert(deploymentHistory).values(rows).run();
  db.insert(deploymentHistory)
    .values([
      {
        id: 'audit-tie-a',
        projectId,
        deploymentId: 'dpl-tie',
        event: 'tie',
        actorType: 'system',
        actor: null,
        details: {},
        createdAt: new Date(5_000),
      },
      {
        id: 'audit-tie-b',
        projectId,
        deploymentId: 'dpl-tie',
        event: 'tie',
        actorType: 'system',
        actor: null,
        details: {},
        createdAt: new Date(5_000),
      },
    ])
    .run();
  db.delete(user).where(eq(user.id, snapshotUserId)).run();
  db.insert(organization)
    .values({
      id: 'audit-other-project',
      name: 'Other',
      slug: 'audit-other-project',
      previewSlug: 'audit-other-project',
    })
    .run();
  db.insert(deploymentHistory)
    .values({
      id: 'audit-other-only',
      projectId: 'audit-other-project',
      deploymentId: 'dpl-other',
      event: 'other-only',
      actorType: 'system',
      actor: null,
      details: {},
    })
    .run();

  const viewer = await caller('audit-viewer@example.com');
  db.insert(member)
    .values({
      id: 'audit-viewer-membership',
      organizationId: projectId,
      userId: viewer.id,
      role: 'viewer',
    })
    .run();
  const page = await viewer.api.deployments.audit({ projectId, offset: 100, limit: 100 });
  expect(page.total).toBe(108);
  expect(page.entries).toHaveLength(8);
  expect(page.events).toEqual(['failed', 'published', 'submitted', 'tie']);
  expect(page.events).not.toContain('other-only');
  expect(page.actors).toContainEqual({ id: 'system', name: 'System' });
  expect(page.actors).toContainEqual({ id: snapshotUserId, name: 'Before deletion' });
  expect(JSON.stringify(page)).not.toContain('audit@example.com');

  const filtered = await viewer.api.deployments.audit({
    projectId,
    event: 'published',
    actor: 'deleted-audit-42',
    search: 'DETAIL 42',
  });
  expect(filtered.total).toBe(1);
  expect(filtered.entries[0]).toMatchObject({
    id: 'audit-042',
    details: { message: 'audit detail 42' },
  });
  expect(filtered.events).toHaveLength(4);

  const ties = await viewer.api.deployments.audit({
    projectId,
    event: 'tie',
    sortBy: 'event',
    sortDirection: 'asc',
  });
  expect(ties.entries.map((entry) => entry.id)).toEqual(['audit-tie-b', 'audit-tie-a']);

  const deploymentScope = await viewer.api.deployments.audit({
    projectId,
    deploymentId: target.id,
  });
  expect(deploymentScope.entries.map((entry) => entry.deploymentId)).toEqual([
    target.id,
    target.id,
  ]);
  expect(deploymentScope.total).toBe(2);
  expect(deploymentScope.events).toEqual(['published', 'submitted']);
  expect(deploymentScope.actors).toEqual([
    { id: 'system', name: 'System' },
    { id: snapshotUserId, name: 'Before deletion' },
  ]);

  const actorByName = await viewer.api.deployments.audit({
    projectId,
    search: 'Historical actor 42',
  });
  expect(actorByName.entries.map((entry) => entry.id)).toEqual(['audit-042']);
  const deploymentById = await viewer.api.deployments.audit({ projectId, search: target.id });
  expect(deploymentById.entries.map((entry) => entry.id)).toContain('audit-000');
  expect(deploymentById.entries).toHaveLength(2);
  const actorById = await viewer.api.deployments.audit({ projectId, search: snapshotUserId });
  expect(actorById.entries.map((entry) => entry.id)).toEqual(['audit-000']);

  const createdAtAscending = await viewer.api.deployments.audit({
    projectId,
    event: 'failed',
    sortBy: 'createdAt',
    sortDirection: 'asc',
  });
  const createdAtDescending = await viewer.api.deployments.audit({
    projectId,
    event: 'failed',
    sortBy: 'createdAt',
    sortDirection: 'desc',
  });
  expect(createdAtAscending.entries[0]?.id).toBe('audit-001');
  expect(createdAtDescending.entries[0]?.id).toBe('audit-103');

  const deploymentAscending = await viewer.api.deployments.audit({
    projectId,
    event: 'failed',
    sortBy: 'deploymentId',
    sortDirection: 'asc',
  });
  const deploymentDescending = await viewer.api.deployments.audit({
    projectId,
    event: 'failed',
    sortBy: 'deploymentId',
    sortDirection: 'desc',
  });
  expect(deploymentAscending.entries[0]?.deploymentId).toBe('dpl-1');
  expect(deploymentDescending.entries[0]?.deploymentId).toBe('dpl-99');

  const actorAscending = await viewer.api.deployments.audit({
    projectId,
    event: 'published',
    sortBy: 'actor',
    sortDirection: 'asc',
  });
  const actorDescending = await viewer.api.deployments.audit({
    projectId,
    event: 'published',
    sortBy: 'actor',
    sortDirection: 'desc',
  });
  expect(actorAscending.entries[0]?.actor).toMatchObject({ name: 'Before deletion' });
  expect(actorDescending.entries[0]?.actor).toBeNull();
});
