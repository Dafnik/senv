import { and, eq } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';
import {
  deploymentArtifact,
  deploymentBranchAlias,
  organization,
} from '../../../../../../drizzle/schema.ts';

import { api, db, projectId, publishStatic } from './deployments.test-support.ts';

test('branch selection follows submission order when readiness completes out of order', async () => {
  const artifactKey = 'b'.repeat(64);
  api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: artifactKey,
    size: 10,
    sha256: artifactKey,
  });
  const artifactId = db
    .select({ id: deploymentArtifact.id })
    .from(deploymentArtifact)
    .where(eq(deploymentArtifact.storageKey, artifactKey))
    .get()!.id;
  const earlier = await publishStatic({
    artifactId,
    source: { commit: 'earlier', branch: 'main' },
    secrets: {},
  });
  const later = await publishStatic({
    artifactId,
    source: { commit: 'later', branch: 'main' },
    secrets: {},
  });
  await api.markDeploymentReady(later.id, new Date('2026-10-03T12:00:00Z'));
  await api.markDeploymentReady(earlier.id, new Date('2026-10-03T12:01:00Z'));
  const alias = db
    .select()
    .from(deploymentBranchAlias)
    .where(
      and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.branch, 'main')),
    )
    .get();
  expect(alias?.deploymentId).toBe(later.id);
  expect(alias?.alias).toBe('br-main');
  expect(api.getProjectDeployment(projectId, later.id).retentionDeadlineAt).toBeNull();
  await api.deleteDeployment(later.id);
  const retired = db
    .select()
    .from(deploymentBranchAlias)
    .where(
      and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.branch, 'main')),
    )
    .get();
  expect(retired?.deploymentId).toBeNull();
  await api.markDeploymentReady(earlier.id, new Date('2026-10-03T12:02:00Z'));
  expect(
    db
      .select()
      .from(deploymentBranchAlias)
      .where(
        and(
          eq(deploymentBranchAlias.projectId, projectId),
          eq(deploymentBranchAlias.branch, 'main'),
        ),
      )
      .get()?.deploymentId,
  ).toBeNull();
  const next = await publishStatic({
    artifactId,
    source: { commit: 'next', branch: 'main' },
    secrets: {},
  });
  await api.markDeploymentReady(next.id);
  const restored = db
    .select()
    .from(deploymentBranchAlias)
    .where(
      and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.branch, 'main')),
    )
    .get();
  expect(restored?.alias).toBe('br-main');
  expect(restored?.deploymentId).toBe(next.id);
});

test('branch aliases normalize names without a suffix and reject collisions before publication', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: '9'.repeat(64),
    size: 1,
    sha256: '9'.repeat(64),
  });
  const first = await publishStatic({
    artifactId: artifact.artifactId,
    source: { branch: 'feature/login' },
    secrets: {},
  });
  const second = await publishStatic({
    artifactId: artifact.artifactId,
    source: { branch: 'feature/login' },
    secrets: {},
  });
  await expect(
    publishStatic({
      artifactId: artifact.artifactId,
      source: { branch: 'feature-login' },
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(
    publishStatic({
      artifactId: artifact.artifactId,
      source: { branch: 'Feature/Login' },
    }),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  const aliases = db
    .select()
    .from(deploymentBranchAlias)
    .where(eq(deploymentBranchAlias.projectId, projectId))
    .all();
  expect(aliases).toHaveLength(1);
  expect(aliases[0]?.alias).toBe('br-feature-login');
  expect(api.listProjectDeployments(projectId)).toHaveLength(2);
  expect(first.id).not.toBe(second.id);
});

test('normalized branch aliases remain DNS-safe for mixed case, separators, and long names', async () => {
  const { branchAlias } = await import('../services/addresses.ts');
  expect(branchAlias('Feature/Login__UI', projectId)).toBe('br-feature-login-ui');
  expect(branchAlias('main', projectId)).toBe('br-main');
  expect(branchAlias('a'.repeat(100), projectId)).toBe(`br-${'a'.repeat(60)}`);
  expect(branchAlias('a'.repeat(59) + '/long', projectId)).toBe(`br-${'a'.repeat(59)}`);
});

test('a stale readiness completion cannot turn a deliberately stopped deployment healthy', async () => {
  const artifact = api.registerUploadedArtifact({
    projectId,
    kind: 'static',
    storageKey: 'f'.repeat(64),
    size: 1,
    sha256: 'f'.repeat(64),
  });
  const target = await publishStatic({
    artifactId: artifact.artifactId,
    source: { branch: 'main' },
    secrets: {},
  });
  await api.markDeploymentReady(target.id);
  await api.stopDeployment(target.id);
  await api.markDeploymentReady(target.id);
  expect(api.getProjectDeployment(projectId, target.id)).toMatchObject({
    status: 'stopped',
    desiredState: 'stopped',
    branchAlias: 'br-main',
  });
  expect(api.getPreviewRouteTargets().deployments).not.toContainEqual(
    expect.objectContaining({ deploymentId: target.id }),
  );
  expect(api.getPreviewRouteTargets().branches).not.toContainEqual(
    expect.objectContaining({ deploymentId: target.id }),
  );
});

test('project slug validation reserves room for the longest deployment label in the full DNS name', async () => {
  // Both base-domain labels are valid DNS labels, but the complete 63 + 63 +
  // 63-character hostname would exceed DNS's 253-character limit.
  vi.stubEnv('PREVIEW_BASE_DOMAIN', `${'a'.repeat(63)}.${'b'.repeat(63)}`);
  await expect(api.updateProjectPreviewSlug(projectId, 's'.repeat(63))).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
  vi.stubEnv('PREVIEW_BASE_DOMAIN', 'preview.localhost');
});

test('slug change rolls back the stored slug and republishes the previous routes when refresh fails', async () => {
  let calls = 0;
  api.registerPreviewRoutesRefresh(async () => {
    calls++;
    if (calls === 1) throw new Error('route file unavailable');
  });
  await expect(api.updateProjectPreviewSlug(projectId, 'new-preview')).rejects.toThrow(
    'rolled back',
  );
  expect(
    db
      .select({ previewSlug: organization.previewSlug })
      .from(organization)
      .where(eq(organization.id, projectId))
      .get()?.previewSlug,
  ).toBe('deployment-test');
  expect(calls).toBe(2);
  api.registerPreviewRoutesRefresh(async () => {});
});
