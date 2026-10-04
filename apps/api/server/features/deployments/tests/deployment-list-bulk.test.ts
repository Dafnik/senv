import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';
import { deploymentBranchAlias, deploymentTag } from '../../../../../../drizzle/schema.ts';
import { api, db, projectId, publishStatic } from './deployments.test-support.ts';

test('runtime config list query count stays fixed as deployments grow', async () => {
  const deployments = await Promise.all(
    Array.from({ length: 5 }, (_, index) => {
      const hash = String(index + 1).repeat(64);
      const artifact = api.registerUploadedArtifact({
        projectId,
        kind: 'static',
        storageKey: hash,
        sha256: hash,
        size: 1,
      });
      return publishStatic({ artifactId: artifact.artifactId });
    }),
  );
  const select = vi.spyOn(db, 'select');
  try {
    const configs = api.listDeploymentRuntimeConfigs();
    expect(configs.map((config) => config.id)).toEqual(deployments.map((row) => row.id));
    expect(configs.every((config) => config.secrets.API_TOKEN === 'never-return-this')).toBe(true);
    expect(select).toHaveBeenCalledTimes(2);
  } finally {
    select.mockRestore();
  }
});

test('deployment list batches aliases and tags while preserving order and project scope', async () => {
  const deployments = await Promise.all(
    Array.from({ length: 4 }, (_, index) => {
      const hash = String(index + 6).repeat(64);
      const artifact = api.registerUploadedArtifact({
        projectId,
        kind: 'static',
        storageKey: hash,
        sha256: hash,
        size: 1,
      });
      return publishStatic({ artifactId: artifact.artifactId });
    }),
  );
  for (const [index, target] of deployments.entries()) {
    db.insert(deploymentBranchAlias)
      .values({
        id: `summary-alias-${index}`,
        projectId,
        branch: `branch-${index}`,
        alias: `alias-${index}`,
        deploymentId: target.id,
      })
      .run();
    db.insert(deploymentTag)
      .values([
        {
          id: `summary-tag-${index}-a`,
          projectId,
          name: `tag-${index}-a`,
          deploymentId: target.id,
        },
        ...(index === 0
          ? [
              {
                id: 'summary-tag-0-b',
                projectId,
                name: 'tag-0-b',
                deploymentId: target.id,
              },
            ]
          : []),
      ])
      .run();
  }
  const select = vi.spyOn(db, 'select');
  try {
    const result = api.listProjectDeployments(projectId);
    expect(result.map((row) => row.id)).toEqual(deployments.map((row) => row.id).reverse());
    expect(result.find((row) => row.id === deployments[0]?.id)).toMatchObject({
      branchAlias: 'alias-0',
      tags: ['tag-0-a', 'tag-0-b'],
    });
    expect(select).toHaveBeenCalledTimes(7);
  } finally {
    select.mockRestore();
  }
  expect(
    db
      .select()
      .from(deploymentBranchAlias)
      .where(eq(deploymentBranchAlias.projectId, projectId))
      .all(),
  ).toHaveLength(4);
});
