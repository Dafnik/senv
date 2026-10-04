import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect } from 'vite-plus/test';
import { createDatabase } from '../../../../drizzle/database.ts';
import type { PublicDeployment } from '../../shared/deployments.ts';
import { DockerEngine } from '../utils/docker-engine.ts';
import type { LifecycleHarness } from './deployment-lifecycle.integration-support.ts';
import {
  authRequest,
  ensureImage,
  rpc,
  startApi,
  stopApi,
} from './deployment-lifecycle.integration-support.ts';
import { freePort, waitFor } from './deployment-lifecycle.integration-network.ts';
import { registerPublicationScenarios } from './deployment-lifecycle-publication.scenarios.ts';
import { registerRoutingScenarios } from './deployment-lifecycle-routing.scenarios.ts';
import { registerRecoveryScenarios } from './deployment-lifecycle-recovery.scenarios.ts';

// Requires `vp run @senv/api#build` and a local Docker daemon. All resources use a
// unique instance label; cleanup never prunes images or another instance's data.
describe.runIf(process.env['SENV_DOCKER_TESTS'] === 'true')('live deployment lifecycle', () => {
  const engine = new DockerEngine();
  const instanceId = `test-${randomBytes(5).toString('hex')}`;
  const network = `senv-preview-${instanceId}`;
  const harness: LifecycleHarness = {
    engine,
    instanceId,
    directory: '',
    apiPort: 0,
    previewPort: 0,
    traefikApiPort: 0,
    apiProcess: undefined,
    apiOutput: '',
    cookie: '',
    project: { id: '', slug: '', previewSlug: '' },
    // The ordered scenarios populate these before the later scenarios read them.
    first: {} as PublicDeployment,
    replacement: {} as PublicDeployment,
    artifactHash: '',
    artifactVolume: '',
  };

  beforeAll(async () => {
    await readFile(resolve('dist/apps/api/server/index.mjs'));
    harness.directory = await mkdtemp(join(tmpdir(), 'senv-lifecycle-'));
    await chmod(harness.directory, 0o755);
    await mkdir(join(harness.directory, 'deployments'), { mode: 0o755 });
    const db = createDatabase(`file:${join(harness.directory, 'senv.sqlite')}`);
    migrate(db, { migrationsFolder: 'drizzle/migrations' });
    db.$client.close();
    harness.apiPort = await freePort();
    await ensureImage(harness, 'traefik:v3.5');
    await ensureImage(harness, 'nginx:alpine');
    await engine.request('POST', '/networks/create', {
      Name: network,
      Labels: { 'senv.instance': instanceId, 'senv.managed': 'true' },
    });
    const created = await engine.request<{ Id: string }>('POST', '/containers/create', {
      Image: 'traefik:v3.5',
      Cmd: [
        '--api.insecure=true',
        '--providers.file.directory=/etc/traefik/dynamic',
        '--providers.file.watch=true',
        '--providers.providersThrottleDuration=0s',
        '--entrypoints.web.address=:80',
      ],
      Labels: { 'senv.instance': instanceId, 'senv.test': 'lifecycle' },
      ExposedPorts: { '80/tcp': {}, '8080/tcp': {} },
      HostConfig: {
        NetworkMode: network,
        Binds: [`${join(harness.directory, 'deployments')}:/etc/traefik/dynamic:ro`],
        PortBindings: {
          '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }],
          '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }],
        },
      },
    });
    await engine.request('POST', `/containers/${created.body.Id}/start`);
    const inspect = await engine.request<{
      NetworkSettings: { Ports: Record<string, Array<{ HostPort: string }>> };
    }>('GET', `/containers/${created.body.Id}/json`);
    harness.previewPort = Number(inspect.body.NetworkSettings.Ports['80/tcp']![0]!.HostPort);
    harness.traefikApiPort = Number(inspect.body.NetworkSettings.Ports['8080/tcp']![0]!.HostPort);
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${harness.traefikApiPort}/api/http/routers`)).ok;
      } catch {
        return false;
      }
    });
    await startApi(harness);
    const setup = await authRequest(harness, 'instance/setup', {
      name: 'Lifecycle test',
      email: 'lifecycle@example.invalid',
      password: 'lifecycle-password-12345',
    });
    expect(setup.status).toBe(200);
    const login = await authRequest(harness, 'sign-in/email', {
      email: 'lifecycle@example.invalid',
      password: 'lifecycle-password-12345',
    });
    expect(login.status).toBe(200);
    harness.cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    harness.project = await rpc(harness, 'projects.create', {
      name: 'Lifecycle site',
      previewSlug: 'lifecycle',
    });
  }, 120_000);

  afterAll(async () => {
    await stopApi(harness);
    const containers = await engine.request<Array<{ Id: string }>>(
      'GET',
      `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify({ label: [`senv.instance=${instanceId}`] }))}`,
    );
    await Promise.all(
      containers.body.map((container) =>
        engine.request('DELETE', `/containers/${container.Id}?force=true&v=true`),
      ),
    );
    await engine.request('DELETE', `/networks/${network}`).catch(() => {});
    if (harness.artifactVolume)
      await engine.request('DELETE', `/volumes/${harness.artifactVolume}`).catch(() => {});
    if (harness.directory) await rm(harness.directory, { recursive: true, force: true });
  }, 60_000);
  registerPublicationScenarios(harness);
  registerRoutingScenarios(harness);
  registerRecoveryScenarios(harness);
});
