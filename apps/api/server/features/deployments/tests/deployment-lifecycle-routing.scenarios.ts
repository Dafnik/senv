import { cp, mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import type { PublicDeployment } from '../../../../shared/deployments.ts';
import { writeTarFromDirectory } from '../runtime/tar.ts';
import { waitFor } from './deployment-lifecycle.integration-network.ts';
import type { LifecycleHarness } from './deployment-lifecycle.integration-support.ts';
import {
  input,
  inspectOrigin,
  preview,
  ready,
  rpc,
  startApi,
  stopApi,
} from './deployment-lifecycle.integration-support.ts';

export function registerRoutingScenarios(harness: LifecycleHarness): void {
  test('reconciles lost containers after API restart and leaves explicitly stopped intent intact', async () => {
    const stopped = await rpc<PublicDeployment>(harness, 'deployments.publish', {
      projectId: harness.project.id,
      kind: 'static',
      reuseDeploymentId: harness.replacement.id,
    });
    await ready(harness, stopped.id);
    await rpc(harness, 'deployments.stop', input(harness, stopped.id));
    await waitFor(async () => !(await inspectOrigin(harness, stopped.id)).State.Running);
    await stopApi(harness);
    for (const role of ['origin', 'proxy']) {
      await harness.engine.request(
        'DELETE',
        `/containers/senv-${harness.instanceId}-${harness.replacement.id}-${role}?force=true`,
      );
    }
    await startApi(harness);
    await ready(harness, harness.replacement.id);
    expect((await preview(harness, 'latest')).status).toBe(200);
    expect(
      (await rpc<PublicDeployment>(harness, 'deployments.detail', input(harness, stopped.id), true))
        .status,
    ).toBe('stopped');
    expect((await inspectOrigin(harness, stopped.id)).State.Running).toBe(false);
    await rpc(harness, 'deployments.delete', input(harness, stopped.id));
  }, 60_000);

  test('serves production static files from the shared read-only artifact volume', async () => {
    const artifactPath = join(harness.directory, 'deployments/artifacts', harness.artifactHash);
    expect((await stat(artifactPath)).mode & 0o777).toBe(0o755);
    expect((await stat(join(artifactPath, 'assets'))).mode & 0o777).toBe(0o755);
    expect((await stat(join(artifactPath, 'index.html'))).mode & 0o777).toBe(0o644);
    harness.artifactVolume = `senv-lifecycle-${harness.instanceId}`;
    await harness.engine.request('POST', '/volumes/create', {
      Name: harness.artifactVolume,
      Labels: { 'senv.test': harness.instanceId },
    });
    const seed = await mkdtemp(join(harness.directory, 'volume-seed-'));
    await cp(join(harness.directory, 'deployments/artifacts'), join(seed, 'artifacts'), {
      recursive: true,
    });
    const archive = join(harness.directory, 'volume-seed.tar');
    await writeTarFromDirectory(seed, archive);
    const helper = await harness.engine.request<{ Id: string }>('POST', '/containers/create', {
      Image: 'nginx:alpine',
      Labels: { 'senv.instance': harness.instanceId, 'senv.test': 'volume-seed' },
      HostConfig: {
        Mounts: [
          { Type: 'volume', Source: harness.artifactVolume, Target: '/var/lib/senv/deployments' },
        ],
      },
    });
    await harness.engine.uploadFile(
      'PUT',
      `/containers/${helper.body.Id}/archive?path=/var/lib/senv/deployments`,
      archive,
    );
    await harness.engine.request('DELETE', `/containers/${helper.body.Id}?force=true`);
    await stopApi(harness);
    await startApi(harness);
    const mounted = await rpc<PublicDeployment>(harness, 'deployments.publish', {
      projectId: harness.project.id,
      kind: 'static',
      reuseDeploymentId: harness.replacement.id,
    });
    await ready(harness, mounted.id);
    const origin = await inspectOrigin(harness, mounted.id);
    expect(origin.Mounts).toContainEqual(
      expect.objectContaining({
        Type: 'volume',
        Name: harness.artifactVolume,
        Destination: '/var/lib/senv/deployments',
        RW: false,
      }),
    );
    expect((await preview(harness, mounted.id)).body).toContain('Fixed version');
    await rpc(harness, 'deployments.delete', input(harness, mounted.id));
  }, 60_000);
}
