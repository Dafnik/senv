import { expect, test } from 'vite-plus/test';
import { api, projectId, publishStatic } from './deployments.test-support.ts';

test('fatal runtime ownership conflict retires an already healthy route', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'a'.repeat(64),
    size: 1,
    sha256: 'a'.repeat(64),
  });
  const target = await publishStatic({ artifactId: artifact.artifactId });
  await api.markDeploymentReady(target.id);
  expect(api.getPreviewRouteTargets().deployments).toContainEqual(
    expect.objectContaining({ deploymentId: target.id }),
  );

  await api.markDeploymentFailed(target.id, 'Container ownership changed.', undefined, {
    stopRuntime: true,
  });

  expect(api.getProjectDeployment(projectId, target.id)).toMatchObject({
    status: 'failed',
    desiredState: 'stopped',
  });
  expect(api.getPreviewRouteTargets().deployments).not.toContainEqual(
    expect.objectContaining({ deploymentId: target.id }),
  );
  expect(api.getPreviewRouteTargets().branches).not.toContainEqual(
    expect.objectContaining({ deploymentId: target.id }),
  );
});
