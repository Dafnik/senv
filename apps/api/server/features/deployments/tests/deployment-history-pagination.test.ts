import { expect, test } from 'vite-plus/test';
import { deploymentHistory } from '../../../../../../drizzle/schema.ts';
import { api, db, projectId } from './deployments.test-support.ts';

test('composite history cursor returns every equal-timestamp event exactly once', () => {
  db.insert(deploymentHistory)
    .values(
      ['a', 'b', 'c'].map((id) => ({
        id: `cursor-${id}`,
        projectId,
        deploymentId: 'cursor-deployment',
        event: 'test',
        actorType: 'system' as const,
        actor: null,
        details: {},
        createdAt: new Date(0),
      })),
    )
    .run();
  const first = api.listDeploymentHistory(projectId, 2);
  const second = api.listDeploymentHistory(projectId, 2, {
    createdAt: first[1]!.createdAt,
    id: first[1]!.id,
  });
  expect(first.map((row) => row.id)).toEqual(['cursor-c', 'cursor-b']);
  expect(second.map((row) => row.id)).toEqual(['cursor-a']);
});

test('history pagination retains the timestamp-only numeric cursor behavior', () => {
  db.insert(deploymentHistory)
    .values([
      {
        id: 'legacy-newer',
        projectId,
        deploymentId: 'legacy-deployment',
        event: 'newer',
        actorType: 'system',
        actor: null,
        details: {},
        createdAt: new Date(2_000),
      },
      {
        id: 'legacy-older',
        projectId,
        deploymentId: 'legacy-deployment',
        event: 'older',
        actorType: 'system',
        actor: null,
        details: {},
        createdAt: new Date(1_000),
      },
    ])
    .run();
  expect(api.listDeploymentHistory(projectId, 10, 2_000).map((row) => row.id)).toEqual([
    'legacy-older',
  ]);
});
