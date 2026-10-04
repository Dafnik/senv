import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { deploymentBranchAlias, deploymentTag, organization } from '../../../../drizzle/schema.ts';
import { api, db, projectId, publishStatic } from './deployments.test-support.ts';

test('preview aliases and tags cannot route a deployment owned by another project', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '3'.repeat(64),
    size: 1,
    sha256: '3'.repeat(64),
  });
  const target = await publishStatic({ artifactId: artifact.artifactId });
  await api.markDeploymentReady(target.id);
  const foreignProjectId = 'foreign-route-project';
  db.insert(organization)
    .values({
      id: foreignProjectId,
      name: 'Foreign route project',
      slug: foreignProjectId,
      previewSlug: 'foreign-route-project',
    })
    .run();
  db.insert(deploymentBranchAlias)
    .values({
      id: 'foreign-branch-alias',
      projectId: foreignProjectId,
      branch: 'main',
      alias: 'br-main',
      deploymentId: target.id,
    })
    .run();
  db.insert(deploymentTag)
    .values({
      id: 'foreign-tag',
      projectId: foreignProjectId,
      name: 'stable',
      deploymentId: target.id,
    })
    .run();

  const routes = api.getPreviewRouteTargets();
  expect(routes.deployments).toContainEqual({
    deploymentId: target.id,
    projectSlug: 'deployment-test',
  });
  expect(routes.branches).toEqual([]);
  expect(routes.tags).toEqual([]);
  db.delete(organization).where(eq(organization.id, foreignProjectId)).run();
});
