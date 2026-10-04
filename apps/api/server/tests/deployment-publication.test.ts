import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { deploymentArtifact, organization } from '../../../../drizzle/schema.ts';
import { deploymentSettingsSchema } from '../../shared/deployments.ts';
import { api, db, projectId, publishStatic } from './deployments.test-support.ts';

test('publication captures immutable settings, redacts saved secrets, and supports artifact reuse', async () => {
  const artifactKey = 'a'.repeat(64);
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: artifactKey,
    size: 42,
    sha256: artifactKey,
  });
  expect(api.getArtifactCleanupState().pending).toContain(artifactKey);
  const first = await publishStatic({
    artifactId: artifact.artifactId,
    source: { commit: 'abc123', branch: 'main' },
  });
  api.updateProjectDeploymentSettings(projectId, {
    ...deploymentSettingsSchema.parse({}),
    repository: 'https://example.com/team/changed.git',
    repositoryProvider: 'gitlab',
    originCpus: '2',
    proxy: {
      routes: [
        {
          path: '/api',
          target: 'https://api.example.com',
          connectTimeoutSeconds: 10,
          readTimeoutSeconds: 60,
        },
      ],
      cacheRules: [],
      compression: { enabled: false, endings: [] },
    },
  });
  const publicValue = api.getProjectDeployment(projectId, first.id);
  expect(JSON.stringify(publicValue)).not.toContain('never-return-this');
  expect(publicValue.config.secretNames).toEqual(['API_TOKEN']);
  expect(publicValue.config.limits.origin.cpus).toBe('1');
  expect(publicValue.source.repository).toBe('https://example.com/team/site.git');
  expect(publicValue.source.repositoryProvider).toBe('github');
  expect(api.getProjectDeploymentSettings(projectId).repositoryProvider).toBe('gitlab');
  expect(publicValue.configurationChanges).toContain('Git provider');
  expect(api.getDeploymentRuntimeConfig(first.id)?.secrets).toEqual({
    API_TOKEN: 'never-return-this',
  });
  expect(() =>
    api.updateProjectDeploymentSettings(projectId, {
      ...deploymentSettingsSchema.parse({}),
      proxy: {
        routes: [
          {
            path: '/api',
            target: 'https://api.example.com',
            connectTimeoutSeconds: 10,
            readTimeoutSeconds: 60,
          },
          {
            path: '/api/',
            target: 'https://other.example.com',
            connectTimeoutSeconds: 10,
            readTimeoutSeconds: 60,
          },
        ],
        cacheRules: [],
        compression: { enabled: true, endings: [] },
      },
    }),
  ).toThrowError();
  expect(() =>
    deploymentSettingsSchema.parse({
      proxy: {
        routes: [
          {
            path: '/api',
            target: 'https://api.example.com;return 200',
            connectTimeoutSeconds: 10,
            readTimeoutSeconds: 60,
          },
        ],
      },
    }),
  ).toThrowError();
  const replacement = await publishStatic({ artifactId: artifact.artifactId, secrets: {} });
  expect(replacement.id).not.toBe(first.id);
  db.insert(organization)
    .values({
      id: 'shared-project',
      name: 'Shared project',
      slug: 'shared-project',
      previewSlug: 'shared-project',
    })
    .run();
  const sharedArtifact = api.registerUploadedArtifact({
    projectId: 'shared-project',
    kind: 'static',
    storageKey: artifactKey,
    size: 42,
    sha256: artifactKey,
  });
  const crossProjectReuse = await api.publishDeployment({
    projectId: 'shared-project',
    kind: 'static',
    artifactId: sharedArtifact.artifactId,
    pinned: false,
    source: {},
    port: 80,
  });
  expect(api.listReferencedArtifactStorageKeys()).toContain(artifactKey);
  expect(api.getArtifactCleanupState().referenced).toContain(artifactKey);
  await api.deleteDeployment(first.id);
  expect(api.listReferencedArtifactStorageKeys()).toContain(artifactKey);
  await api.deleteDeployment(replacement.id);
  expect(api.listReferencedArtifactStorageKeys()).toContain(artifactKey);
  await api.deleteDeployment(crossProjectReuse.id);
  expect(api.getArtifactCleanupState().released).toContain(artifactKey);
  expect(api.forgetArtifactStorageKey(artifactKey)).toBe(true);
  expect(
    db
      .select()
      .from(deploymentArtifact)
      .where(eq(deploymentArtifact.storageKey, artifactKey))
      .all(),
  ).toHaveLength(0);
});
