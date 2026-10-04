import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import type { DeploymentResourceHistory } from '../../../../shared/deployment-resources';
import type { PublicDeployment } from '../../../../shared/deployments.ts';
import { waitFor } from './deployment-lifecycle.integration-network.ts';
import type { LifecycleHarness } from './deployment-lifecycle.integration-support.ts';
import {
  input,
  inspectOrigin,
  preview,
  ready,
  rpc,
} from './deployment-lifecycle.integration-support.ts';

export function registerPublicationScenarios(harness: LifecycleHarness): void {
  test('publishes root files, captures limits/secrets, and serves deployment and branch hosts', async () => {
    const files = new FormData();
    files.append('projectId', harness.project.id);
    files.append('files', new Blob(['<!doctype html><h1>Fixed version</h1>']), 'site/index.html');
    files.append('files', new Blob(['asset']), 'site/assets/app.js');
    const upload = await fetch(`http://localhost:${harness.apiPort}/api/deployments/artifacts`, {
      method: 'POST',
      headers: { cookie: harness.cookie, origin: 'http://localhost:4200' },
      body: files,
    });
    expect(upload.status).toBe(200);
    const artifact = (await upload.json()) as { artifactId: string; sha256: string };
    harness.artifactHash = artifact.sha256;
    await rpc(harness, 'projects.updateRuntime', {
      projectId: harness.project.id,
      runtime: { env: { PUBLIC_MODE: 'test' }, secrets: { HIDDEN_TOKEN: 'dummy-secret-value' } },
    });
    harness.first = await rpc<PublicDeployment>(harness, 'deployments.publish', {
      projectId: harness.project.id,
      kind: 'static',
      artifactId: artifact.artifactId,
      source: { branch: 'main', commit: 'first' },
    });
    await ready(harness, harness.first.id);
    const resources = await rpc<{
      status: string;
      cpuPercent?: number;
      memoryUsedBytes?: number;
      memoryLimitBytes?: number | null;
    }>(harness, 'deployments.resources', input(harness, harness.first.id), true);
    expect(resources.status).toBe('available');
    expect(Number.isFinite(resources.cpuPercent)).toBe(true);
    expect(resources.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(resources.memoryUsedBytes).toBeGreaterThan(0);
    expect(resources.memoryLimitBytes).toBe(512 * 1024 * 1024);
    await waitFor(async () => {
      const history = await rpc<DeploymentResourceHistory>(
        harness,
        'deployments.resourceHistory',
        input(harness, harness.first.id),
        true,
      );
      expect(history.intervalMs).toBe(30_000);
      expect(history.points).toHaveLength(40);
      return history.points.some(
        (point) =>
          point.cpuPercent !== null && point.memoryUsedBytes !== null && point.memoryUsedBytes > 0,
      );
    });
    expect(await preview(harness, harness.first.id)).toEqual({
      status: 200,
      body: '<!doctype html><h1>Fixed version</h1>',
    });
    expect((await preview(harness, 'br-main')).status).toBe(200);
    const detail = await rpc<PublicDeployment>(
      harness,
      'deployments.detail',
      input(harness, harness.first.id),
      true,
    );
    expect(detail.config.secretNames).toEqual(['HIDDEN_TOKEN']);
    expect(JSON.stringify(detail)).not.toContain('dummy-secret-value');
    const origin = await inspectOrigin(harness, harness.first.id);
    expect(origin.HostConfig.Memory).toBe(512 * 1024 * 1024);
    expect(origin.HostConfig.NanoCpus).toBe(1_000_000_000);
    expect(origin.HostConfig.LogConfig.Config).toMatchObject({
      'max-size': '10m',
      'max-file': '3',
    });
  }, 60_000);

  test('reuses content independently and retires slug/tag/stopped URLs before mutation returns', async () => {
    harness.replacement = await rpc<PublicDeployment>(harness, 'deployments.publish', {
      projectId: harness.project.id,
      kind: 'static',
      reuseDeploymentId: harness.first.id,
      source: { branch: 'main', commit: 'replacement' },
    });
    await ready(harness, harness.replacement.id);
    await rpc(harness, 'deployments.assignTag', {
      ...input(harness, harness.replacement.id),
      name: 'latest',
    });
    expect((await preview(harness, 'latest')).status).toBe(200);
    await rpc(harness, 'projects.updatePreviewSlug', {
      projectId: harness.project.id,
      previewSlug: 'renamed',
    });
    expect((await preview(harness, harness.first.id, 'lifecycle')).status).toBe(404);
    expect((await preview(harness, 'br-main', 'lifecycle')).status).toBe(404);
    expect((await preview(harness, 'latest', 'lifecycle')).status).toBe(404);
    harness.project.previewSlug = 'renamed';
    expect((await preview(harness, 'latest')).status).toBe(200);
    const reusedSlug = await rpc<{ id: string; slug: string }>(harness, 'projects.create', {
      name: 'Another site',
      previewSlug: 'lifecycle',
    });
    expect(reusedSlug.id).not.toBe(harness.project.id);
    expect(harness.project.slug).toBe(harness.project.id);
    await rpc(harness, 'deployments.stop', input(harness, harness.replacement.id));
    expect((await preview(harness, harness.replacement.id)).status).toBe(404);
    expect((await preview(harness, 'br-main')).status).toBe(404);
    expect((await preview(harness, 'latest')).status).toBe(404);
    await waitFor(async () => {
      const resources = await rpc<{ status: string }>(
        harness,
        'deployments.resources',
        input(harness, harness.replacement.id),
        true,
      );
      return resources.status === 'unavailable';
    });
    await rpc(harness, 'deployments.restart', input(harness, harness.replacement.id));
    await ready(harness, harness.replacement.id);
    expect((await preview(harness, 'latest')).status).toBe(200);
    await rpc(harness, 'deployments.delete', input(harness, harness.first.id));
    expect((await preview(harness, harness.first.id)).status).toBe(404);
    expect((await preview(harness, harness.replacement.id)).status).toBe(200);
    expect(
      await readFile(
        join(harness.directory, 'deployments/artifacts', harness.artifactHash, 'index.html'),
        'utf8',
      ),
    ).toContain('Fixed version');
    const deleted = await rpc<PublicDeployment>(
      harness,
      'deployments.detail',
      input(harness, harness.first.id),
      true,
    );
    expect(deleted.status).toBe('deleted');
    expect(deleted.artifactId).toBeNull();
    expect(deleted.config.secretNames).toEqual(['HIDDEN_TOKEN']);
  }, 90_000);
}
