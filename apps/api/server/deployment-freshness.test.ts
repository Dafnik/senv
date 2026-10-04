import { expect, test } from 'vite-plus/test';
import { api, projectId, publishStatic } from './deployments.test-support';
test('configuration freshness compares current settings and runtime values without exposing secret fingerprints', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'd'.repeat(64),
    sha256: 'd'.repeat(64),
    size: 20,
  });
  const originalSettings = api.getProjectDeploymentSettings(projectId);
  const result = await publishStatic({ artifactId: artifact.artifactId });
  expect(result.configurationOutdated).toBe(false);
  api.updateProjectDeploymentSettings(projectId, {
    ...originalSettings,
    health: { ...originalSettings.health, path: '/health' },
    originCpus: '2',
    spaFallback: !originalSettings.spaFallback,
  });
  const changed = api.getProjectDeployment(projectId, result.id);
  expect(changed.configurationOutdated).toBe(true);
  expect(changed.configurationChanges).toEqual(
    expect.arrayContaining(['Health checks', 'Origin resources', 'Client-side routing']),
  );
  api.updateProjectDeploymentSettings(projectId, originalSettings);
  api.updateProjectRuntime(projectId, {
    env: { PUBLIC_MODE: 'preview' },
    secrets: { API_TOKEN: 'new-secret-value' },
  });
  expect(api.getProjectDeployment(projectId, result.id).configurationChanges).toEqual([
    'Runtime secrets',
  ]);
  await api.deleteDeployment(result.id);
  expect(api.getProjectDeployment(projectId, result.id).configurationChanges).toEqual([
    'Runtime secrets',
  ]);
  api.updateProjectRuntime(projectId, {
    env: { PUBLIC_MODE: 'preview' },
    secrets: { API_TOKEN: 'never-return-this' },
  });
  expect(api.getProjectDeployment(projectId, result.id).configurationOutdated).toBe(false);
  const publicJson = JSON.stringify(api.getProjectDeployment(projectId, result.id));
  expect(publicJson).not.toContain('runtimeFingerprint');
  expect(publicJson).not.toContain('never-return-this');
  expect(api.listProjectDeployments(projectId)[0]!.previewUrl).toContain(
    result.id + '.deployment-test.',
  );
});
