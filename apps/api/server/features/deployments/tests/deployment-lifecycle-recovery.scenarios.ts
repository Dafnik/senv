import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { createDatabase } from '../../../../../../drizzle/database.ts';
import type { PublicDeployment } from '../../../../shared/deployments.ts';
import { waitFor } from './deployment-lifecycle.integration-network.ts';
import type { LifecycleHarness } from './deployment-lifecycle.integration-support.ts';
import {
  ensureImage,
  input,
  inspectOrigin,
  preview,
  ready,
  rpc,
  startApi,
  stopApi,
} from './deployment-lifecycle.integration-support.ts';

export function registerRecoveryScenarios(harness: LifecycleHarness): void {
  test('pins a container image digest and removes final artifact bytes, secrets, logs, and selections', async () => {
    await ensureImage(harness, 'jmalloc/echo-server:v0.3.7');
    await rpc(harness, 'projects.updateRuntime', {
      projectId: harness.project.id,
      runtime: {
        env: {},
        secrets: { TEST_VALUE: 'dummy-container-secret' },
        removeSecretNames: ['HIDDEN_TOKEN'],
      },
    });
    const container = await rpc<PublicDeployment>(harness, 'deployments.publish', {
      projectId: harness.project.id,
      kind: 'container',
      image: 'jmalloc/echo-server:v0.3.7',
      port: 8080,
      source: { branch: 'container' },
    });
    await ready(harness, container.id);
    const detail = await rpc<PublicDeployment>(
      harness,
      'deployments.detail',
      input(harness, container.id),
      true,
    );
    expect(detail.imageDigest).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect((await inspectOrigin(harness, container.id)).Config.Image).toBe(detail.imageDigest);
    expect((await preview(harness, container.id)).status).toBe(200);
    // Simulate an API crash after persisting a delete intent but before Docker removal.
    await stopApi(harness);
    const interrupted = createDatabase(`file:${join(harness.directory, 'senv.sqlite')}`);
    try {
      interrupted.$client
        .prepare(
          "update deployment set cleanupStartedAt = ?, cleanupAction = 'delete' where id = ?",
        )
        .run(Date.now(), container.id);
    } finally {
      interrupted.$client.close();
    }
    await startApi(harness);
    await waitFor(async () => {
      const recovered = await rpc<PublicDeployment>(
        harness,
        'deployments.detail',
        input(harness, container.id),
        true,
      );
      return recovered.status === 'deleted' && !recovered.removalPending;
    });
    expect((await preview(harness, container.id)).status).toBe(404);
    await rpc(harness, 'deployments.delete', input(harness, harness.replacement.id));
    expect((await preview(harness, 'latest')).status).toBe(404);
    expect((await preview(harness, 'br-main')).status).toBe(404);
    await waitFor(async () => {
      try {
        await readFile(
          join(harness.directory, 'deployments/artifacts', harness.artifactHash, 'index.html'),
        );
        return false;
      } catch {
        return true;
      }
    });
    const db = createDatabase(`file:${join(harness.directory, 'senv.sqlite')}`);
    try {
      expect(db.$client.prepare('select count(*) as n from deploymentSecret').get()).toEqual({
        n: 0,
      });
      expect(db.$client.prepare('select count(*) as n from deploymentLog').get()).toEqual({ n: 0 });
    } finally {
      db.$client.close();
    }
    await rpc(harness, 'deployments.removeHistory', input(harness, harness.replacement.id));
    const history = await rpc<Array<{ deploymentId: string }>>(
      harness,
      'deployments.history',
      { projectId: harness.project.id },
      true,
    );
    expect(history.some((event) => event.deploymentId === harness.replacement.id)).toBe(false);
  }, 120_000);
}
