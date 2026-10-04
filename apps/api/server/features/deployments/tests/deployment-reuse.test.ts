import { expect, test } from 'vite-plus/test';
import { organization } from '../../../../../../drizzle/schema.ts';

import { api, db, projectId } from './deployments.test-support.ts';

test('container reuse preserves the resolved digest and captured registry auth after credential removal', async () => {
  const credentials = api.saveRegistryCredential({
    projectId,
    name: 'private registry',
    registry: 'registry.example.com',
    username: 'publisher',
    secret: 'registry-password',
  });
  const credential = credentials[0]!;
  api.updateProjectRuntime(projectId, { env: {}, secrets: { API_TOKEN: 'first-secret' } });
  const original = await api.publishDeployment({
    projectId,
    kind: 'container',
    image: 'registry.example.com/app:mutable',
    registryCredentialId: credential.id,
    pinned: true,
    source: {},
    port: 3000,
  });
  const digest = 'registry.example.com/app@sha256:' + 'f'.repeat(64);
  api.setDeploymentImageDigest(original.id, digest);
  api.deleteRegistryCredential(projectId, credential.id);
  const publicOriginal = api.getProjectDeployment(projectId, original.id);
  expect(publicOriginal.config.registryCredentialId).toBe(credential.id);
  expect(JSON.stringify(publicOriginal)).not.toContain('registry-password');
  api.updateProjectRuntime(projectId, { env: {}, secrets: { API_TOKEN: 'replacement-secret' } });
  const replacement = await api.publishDeployment({
    projectId,
    kind: 'container',
    reuseDeploymentId: original.id,
    pinned: false,
    source: {},
    port: 8080,
  });
  expect(replacement.imageDigest).toBe(digest);
  expect(api.getProjectDeployment(projectId, replacement.id).config.registryCredentialId).toBe(
    credential.id,
  );
  expect(api.getDeploymentRuntimeConfig(replacement.id)).toMatchObject({
    imageDigest: digest,
    registryAuth: {
      serverAddress: 'registry.example.com',
      username: 'publisher',
      password: 'registry-password',
    },
    secrets: { API_TOKEN: 'replacement-secret' },
  });
  const replacementCredential = api.saveRegistryCredential({
    projectId,
    name: 'replacement registry',
    registry: 'registry.example.com',
    username: 'replacement-publisher',
    secret: 'replacement-registry-password',
  })[0]!;
  const credentialOverride = await api.publishDeployment({
    projectId,
    kind: 'container',
    reuseDeploymentId: original.id,
    registryCredentialId: replacementCredential.id,
    pinned: false,
    source: {},
    port: 3000,
  });
  expect(
    api.getProjectDeployment(projectId, credentialOverride.id).config.registryCredentialId,
  ).toBe(replacementCredential.id);
  expect(api.getDeploymentRuntimeConfig(credentialOverride.id)?.registryAuth).toMatchObject({
    username: 'replacement-publisher',
    password: 'replacement-registry-password',
  });
  expect(JSON.stringify(api.getProjectDeployment(projectId, replacement.id))).not.toContain(
    'registry-password',
  );
  db.insert(organization)
    .values({
      id: 'other-project',
      name: 'Other',
      slug: 'other-project',
      previewSlug: 'other-project',
    })
    .run();
  await expect(
    api.publishDeployment({
      projectId: 'other-project',
      kind: 'container',
      reuseDeploymentId: original.id,
      pinned: false,
      source: {},
      port: 80,
    }),
  ).rejects.toThrowError();
  await expect(
    api.publishDeployment({
      projectId: 'other-project',
      kind: 'static',
      artifactId: 'not-owned',
      pinned: false,
      source: {},
      port: 80,
    }),
  ).rejects.toThrowError();
});
