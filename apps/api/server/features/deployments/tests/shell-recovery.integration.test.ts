import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { DockerEngine } from '../../../infrastructure/docker-engine';
import { ShellExec, recoverShells } from '../runtime/shell-exec';
import { deploymentInstanceId } from '../runtime/identity';
import { deploymentStorageRoot } from '../storage/storage';
import { api, projectId } from './deployments.test-support';
const execute = promisify(execFile);
const available = await execute('docker', ['info', '--format', '{{.ServerVersion}}']).then(
  () => true,
  () => false,
);

test.skipIf(!available)(
  'restart recovery kills marked shells with explicit paths while preserving the origin process',
  async () => {
    const row = await api.publishDeployment({
      projectId,
      kind: 'container',
      image: 'alpine:3.22',
      port: 80,
      pinned: false,
      source: {},
    });
    const engine = new DockerEngine();
    const created = await engine.request<{ Id: string }>('POST', '/containers/create', {
      Image: 'alpine:3.22',
      Cmd: ['/bin/sh', '-c', 'mkdir -p /custom; ln -s /bin/sh /custom/sh; exec sleep 300'],
      Labels: {
        'senv.managed': 'true',
        'senv.instance': deploymentInstanceId(),
        'senv.project': projectId,
        'senv.deployment': row.id,
        'senv.role': 'origin',
      },
    });
    const execution = new ShellExec(engine, created.body.Id, '/custom/sh');
    try {
      await engine.request('POST', `/containers/${created.body.Id}/start`);
      const stream = await execution.start(80, 24);
      stream.resume();
      stream.write("trap '' HUP; sleep 300 &\n");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(await execution.inspect()).toMatchObject({ Running: true });
      await recoverShells(engine);
      expect(await execution.inspect()).toMatchObject({ Running: false });
      expect(
        (
          await engine.request<{ State: { Running: boolean } }>(
            'GET',
            `/containers/${created.body.Id}/json`,
          )
        ).body.State.Running,
      ).toBe(true);
      expect(await readdir(join(deploymentStorageRoot(), 'shell-recovery'))).not.toContain(
        `${execution.marker}.json`,
      );
    } finally {
      await execution.close().catch(() => {});
      await engine.request('DELETE', `/containers/${created.body.Id}?force=true`).catch(() => {});
    }
  },
);

for (const [mode, image, command] of [
  ['bash-only', 'postgres:17.11-bookworm', ['/bin/bash', '-c', 'rm -f /bin/sh; exec sleep 300']],
  ['shell-less', 'alpine:3.22', ['/bin/sh', '-c', 'rm -f /bin/sh /bin/ash; exec sleep 300']],
] as const)
  test.skipIf(!available)(
    `real Docker grant handles a ${mode} image`,
    async () => {
      const { eq } = await import('drizzle-orm');
      const { deployment, session, user } = await import('../../../../../../drizzle/schema');
      const { db, developerId } = await import('./deployments.test-support');
      const { createShellGrant, shellInput } = await import('../services/shell');
      const { containerName } = await import('../runtime/preview-route-identity');
      const row = await api.publishDeployment({
        projectId,
        kind: 'container',
        image,
        port: 80,
        pinned: false,
        source: {},
      });
      db.update(deployment).set({ status: 'healthy' }).where(eq(deployment.id, row.id)).run();
      const current = db
        .insert(session)
        .values({
          id: mode,
          token: mode,
          userId: developerId,
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning()
        .get()!;
      const actor = {
        user: db.select().from(user).where(eq(user.id, developerId)).get()!,
        session: current,
        automation: null,
      };
      const engine = new DockerEngine();
      try {
        await engine.request('GET', `/images/${encodeURIComponent(image)}/json`);
      } catch {
        await engine.request('POST', `/images/create?fromImage=${encodeURIComponent(image)}`);
      }
      const created = await engine.request<{ Id: string }>(
        'POST',
        `/containers/create?name=${containerName(deploymentInstanceId(), row.id, 'origin')}`,
        {
          Image: image,
          Entrypoint: [],
          Cmd: [...command],
          Labels: {
            'senv.managed': 'true',
            'senv.instance': deploymentInstanceId(),
            'senv.project': projectId,
            'senv.deployment': row.id,
            'senv.role': 'origin',
          },
        },
      );
      try {
        await engine.request('POST', `/containers/${created.body.Id}/start`);
        await new Promise((resolve) => setTimeout(resolve, 50));
        const input = shellInput.parse({ projectId, deploymentId: row.id });
        if (mode === 'bash-only')
          expect(await createShellGrant(actor, input)).toMatchObject({ executable: '/bin/bash' });
        else
          await expect(createShellGrant(actor, input)).rejects.toThrow('no supported POSIX shell');
      } finally {
        await engine.request('DELETE', `/containers/${created.body.Id}?force=true`).catch(() => {});
      }
    },
    120_000,
  );
