import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createDatabase } from '../../../drizzle/database';
import type { PublicDeployment } from '../shared/deployments';
import { DockerEngine } from './utils/docker-engine';
import { writeTarFromDirectory } from './utils/deployment-runtime/tar';

// Requires `vp run @senv/api#build` and a local Docker daemon. All resources use a
// unique instance label; cleanup never prunes images or another instance's data.
describe.runIf(process.env['SENV_DOCKER_TESTS'] === 'true')('live deployment lifecycle', () => {
  const engine = new DockerEngine();
  const instanceId = `test-${randomBytes(5).toString('hex')}`;
  const network = `senv-preview-${instanceId}`;
  let directory: string;
  let apiPort: number;
  let previewPort: number;
  let traefikApiPort: number;
  let apiProcess: ChildProcess | undefined;
  let apiOutput = '';
  let cookie: string;
  let project: { id: string; slug: string; previewSlug: string };
  let first: PublicDeployment;
  let replacement: PublicDeployment;
  let artifactHash: string;
  let artifactVolume = '';

  beforeAll(async () => {
    await readFile(resolve('dist/apps/api/server/index.mjs'));
    directory = await mkdtemp(join(tmpdir(), 'senv-lifecycle-'));
    await chmod(directory, 0o755);
    await mkdir(join(directory, 'deployments'), { mode: 0o755 });
    const db = createDatabase(`file:${join(directory, 'senv.sqlite')}`);
    migrate(db, { migrationsFolder: 'drizzle/migrations' });
    db.$client.close();
    apiPort = await freePort();
    await ensureImage('traefik:v3.5');
    await ensureImage('nginx:alpine');
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
        Binds: [`${join(directory, 'deployments')}:/etc/traefik/dynamic:ro`],
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
    previewPort = Number(inspect.body.NetworkSettings.Ports['80/tcp']![0]!.HostPort);
    traefikApiPort = Number(inspect.body.NetworkSettings.Ports['8080/tcp']![0]!.HostPort);
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${traefikApiPort}/api/http/routers`)).ok;
      } catch {
        return false;
      }
    });
    await startApi();
    const setup = await authRequest('instance/setup', {
      name: 'Lifecycle test',
      email: 'lifecycle@example.invalid',
      password: 'lifecycle-password-12345',
    });
    expect(setup.status).toBe(200);
    const login = await authRequest('sign-in/email', {
      email: 'lifecycle@example.invalid',
      password: 'lifecycle-password-12345',
    });
    expect(login.status).toBe(200);
    cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    project = await rpc('projects.create', { name: 'Lifecycle site', previewSlug: 'lifecycle' });
  }, 120_000);

  afterAll(async () => {
    await stopApi();
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
    if (artifactVolume)
      await engine.request('DELETE', `/volumes/${artifactVolume}`).catch(() => {});
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 60_000);

  test('publishes root files, captures limits/secrets, and serves deployment and branch hosts', async () => {
    const files = new FormData();
    files.append('projectId', project.id);
    files.append('files', new Blob(['<!doctype html><h1>Fixed version</h1>']), 'site/index.html');
    files.append('files', new Blob(['asset']), 'site/assets/app.js');
    const upload = await fetch(`http://localhost:${apiPort}/api/deployments/artifacts`, {
      method: 'POST',
      headers: { cookie, origin: 'http://localhost:4200' },
      body: files,
    });
    expect(upload.status).toBe(200);
    const artifact = (await upload.json()) as { artifactId: string; sha256: string };
    artifactHash = artifact.sha256;
    await rpc('projects.updateRuntime', {
      projectId: project.id,
      runtime: { env: { PUBLIC_MODE: 'test' }, secrets: { HIDDEN_TOKEN: 'dummy-secret-value' } },
    });
    first = await rpc('deployments.publish', {
      projectId: project.id,
      kind: 'static',
      artifactId: artifact.artifactId,
      source: { branch: 'main', commit: 'first' },
    });
    await ready(first.id);
    expect(await preview(first.id)).toEqual({
      status: 200,
      body: '<!doctype html><h1>Fixed version</h1>',
    });
    expect((await preview('br-main')).status).toBe(200);
    const detail = await rpc<PublicDeployment>('deployments.detail', input(first.id), true);
    expect(detail.config.secretNames).toEqual(['HIDDEN_TOKEN']);
    expect(JSON.stringify(detail)).not.toContain('dummy-secret-value');
    const origin = await inspectOrigin(first.id);
    expect(origin.HostConfig.Memory).toBe(512 * 1024 * 1024);
    expect(origin.HostConfig.NanoCpus).toBe(1_000_000_000);
    expect(origin.HostConfig.LogConfig.Config).toMatchObject({
      'max-size': '10m',
      'max-file': '3',
    });
  }, 60_000);

  test('reuses content independently and retires slug/tag/stopped URLs before mutation returns', async () => {
    replacement = await rpc('deployments.publish', {
      projectId: project.id,
      kind: 'static',
      reuseDeploymentId: first.id,
      source: { branch: 'main', commit: 'replacement' },
    });
    await ready(replacement.id);
    await rpc('deployments.assignTag', { ...input(replacement.id), name: 'latest' });
    expect((await preview('latest')).status).toBe(200);
    await rpc('projects.updatePreviewSlug', { projectId: project.id, previewSlug: 'renamed' });
    expect((await preview(first.id, 'lifecycle')).status).toBe(404);
    expect((await preview('br-main', 'lifecycle')).status).toBe(404);
    expect((await preview('latest', 'lifecycle')).status).toBe(404);
    project.previewSlug = 'renamed';
    expect((await preview('latest')).status).toBe(200);
    const reusedSlug = await rpc<{ id: string; slug: string }>('projects.create', {
      name: 'Another site',
      previewSlug: 'lifecycle',
    });
    expect(reusedSlug.id).not.toBe(project.id);
    expect(project.slug).toBe(project.id);
    await rpc('deployments.stop', input(replacement.id));
    expect((await preview(replacement.id)).status).toBe(404);
    expect((await preview('br-main')).status).toBe(404);
    expect((await preview('latest')).status).toBe(404);
    await rpc('deployments.restart', input(replacement.id));
    await ready(replacement.id);
    expect((await preview('latest')).status).toBe(200);
    await rpc('deployments.delete', input(first.id));
    expect((await preview(first.id)).status).toBe(404);
    expect((await preview(replacement.id)).status).toBe(200);
    expect(
      await readFile(join(directory, 'deployments/artifacts', artifactHash, 'index.html'), 'utf8'),
    ).toContain('Fixed version');
    const deleted = await rpc<PublicDeployment>('deployments.detail', input(first.id), true);
    expect(deleted.status).toBe('deleted');
    expect(deleted.artifactId).toBeNull();
    expect(deleted.config.secretNames).toEqual(['HIDDEN_TOKEN']);
  }, 90_000);

  test('reconciles lost containers after API restart and leaves explicitly stopped intent intact', async () => {
    const stopped = await rpc<PublicDeployment>('deployments.publish', {
      projectId: project.id,
      kind: 'static',
      reuseDeploymentId: replacement.id,
    });
    await ready(stopped.id);
    await rpc('deployments.stop', input(stopped.id));
    await waitFor(async () => !(await inspectOrigin(stopped.id)).State.Running);
    await stopApi();
    for (const role of ['origin', 'proxy']) {
      await engine.request(
        'DELETE',
        `/containers/senv-${instanceId}-${replacement.id}-${role}?force=true`,
      );
    }
    await startApi();
    await ready(replacement.id);
    expect((await preview('latest')).status).toBe(200);
    expect(
      (await rpc<PublicDeployment>('deployments.detail', input(stopped.id), true)).status,
    ).toBe('stopped');
    expect((await inspectOrigin(stopped.id)).State.Running).toBe(false);
    await rpc('deployments.delete', input(stopped.id));
  }, 60_000);

  test('serves production static files from the shared read-only artifact volume', async () => {
    const artifactPath = join(directory, 'deployments/artifacts', artifactHash);
    expect((await stat(artifactPath)).mode & 0o777).toBe(0o755);
    expect((await stat(join(artifactPath, 'assets'))).mode & 0o777).toBe(0o755);
    expect((await stat(join(artifactPath, 'index.html'))).mode & 0o777).toBe(0o644);
    artifactVolume = `senv-lifecycle-${instanceId}`;
    await engine.request('POST', '/volumes/create', {
      Name: artifactVolume,
      Labels: { 'senv.test': instanceId },
    });
    const seed = await mkdtemp(join(directory, 'volume-seed-'));
    await cp(join(directory, 'deployments/artifacts'), join(seed, 'artifacts'), {
      recursive: true,
    });
    const archive = join(directory, 'volume-seed.tar');
    await writeTarFromDirectory(seed, archive);
    const helper = await engine.request<{ Id: string }>('POST', '/containers/create', {
      Image: 'nginx:alpine',
      Labels: { 'senv.instance': instanceId, 'senv.test': 'volume-seed' },
      HostConfig: {
        Mounts: [{ Type: 'volume', Source: artifactVolume, Target: '/var/lib/senv/deployments' }],
      },
    });
    await engine.uploadFile(
      'PUT',
      `/containers/${helper.body.Id}/archive?path=/var/lib/senv/deployments`,
      archive,
    );
    await engine.request('DELETE', `/containers/${helper.body.Id}?force=true`);
    await stopApi();
    await startApi();
    const mounted = await rpc<PublicDeployment>('deployments.publish', {
      projectId: project.id,
      kind: 'static',
      reuseDeploymentId: replacement.id,
    });
    await ready(mounted.id);
    const origin = await inspectOrigin(mounted.id);
    expect(origin.Mounts).toContainEqual(
      expect.objectContaining({
        Type: 'volume',
        Name: artifactVolume,
        Destination: '/var/lib/senv/deployments',
        RW: false,
      }),
    );
    expect((await preview(mounted.id)).body).toContain('Fixed version');
    await rpc('deployments.delete', input(mounted.id));
  }, 60_000);

  test('pins a container image digest and removes final artifact bytes, secrets, logs, and selections', async () => {
    await ensureImage('jmalloc/echo-server:v0.3.7');
    await rpc('projects.updateRuntime', {
      projectId: project.id,
      runtime: {
        env: {},
        secrets: { TEST_VALUE: 'dummy-container-secret' },
        removeSecretNames: ['HIDDEN_TOKEN'],
      },
    });
    const container = await rpc<PublicDeployment>('deployments.publish', {
      projectId: project.id,
      kind: 'container',
      image: 'jmalloc/echo-server:v0.3.7',
      port: 8080,
      source: { branch: 'container' },
    });
    await ready(container.id);
    const detail = await rpc<PublicDeployment>('deployments.detail', input(container.id), true);
    expect(detail.imageDigest).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect((await inspectOrigin(container.id)).Config.Image).toBe(detail.imageDigest);
    expect((await preview(container.id)).status).toBe(200);
    // Simulate an API crash after persisting a delete intent but before Docker removal.
    await stopApi();
    const interrupted = createDatabase(`file:${join(directory, 'senv.sqlite')}`);
    try {
      interrupted.$client
        .prepare(
          "update deployment set cleanupStartedAt = ?, cleanupAction = 'delete' where id = ?",
        )
        .run(Date.now(), container.id);
    } finally {
      interrupted.$client.close();
    }
    await startApi();
    await waitFor(async () => {
      const recovered = await rpc<PublicDeployment>(
        'deployments.detail',
        input(container.id),
        true,
      );
      return recovered.status === 'deleted' && !recovered.removalPending;
    });
    expect((await preview(container.id)).status).toBe(404);
    await rpc('deployments.delete', input(replacement.id));
    expect((await preview('latest')).status).toBe(404);
    expect((await preview('br-main')).status).toBe(404);
    await waitFor(async () => {
      try {
        await readFile(join(directory, 'deployments/artifacts', artifactHash, 'index.html'));
        return false;
      } catch {
        return true;
      }
    });
    const db = createDatabase(`file:${join(directory, 'senv.sqlite')}`);
    try {
      expect(db.$client.prepare('select count(*) as n from deploymentSecret').get()).toEqual({
        n: 0,
      });
      expect(db.$client.prepare('select count(*) as n from deploymentLog').get()).toEqual({ n: 0 });
    } finally {
      db.$client.close();
    }
    await rpc('deployments.removeHistory', input(replacement.id));
    const history = await rpc<Array<{ deploymentId: string }>>(
      'deployments.history',
      { projectId: project.id },
      true,
    );
    expect(history.some((event) => event.deploymentId === replacement.id)).toBe(false);
  }, 120_000);

  function input(deploymentId: string) {
    return { projectId: project.id, deploymentId };
  }
  async function ready(deploymentId: string) {
    await waitFor(async () => {
      const detail = await rpc<PublicDeployment>('deployments.detail', input(deploymentId), true);
      if (detail.status === 'failed')
        throw new Error(`Deployment failed: ${detail.failureReason}\n${apiOutput}`);
      return detail.status === 'healthy' && (await preview(deploymentId)).status === 200;
    });
  }
  async function rpc<T>(method: string, data: unknown, query = false): Promise<T> {
    const url = `http://localhost:${apiPort}/api/trpc/${method}`;
    const response = await fetch(
      query ? `${url}?input=${encodeURIComponent(JSON.stringify({ json: data }))}` : url,
      {
        method: query ? 'GET' : 'POST',
        headers: { cookie, origin: 'http://localhost:4200', 'content-type': 'application/json' },
        ...(query ? {} : { body: JSON.stringify({ json: data }) }),
      },
    );
    const value = (await response.json()) as { result?: { data: { json: T } }; error?: unknown };
    if (!response.ok || !value.result) {
      const routes = await readFile(join(directory, 'deployments/senv-routes.yml'), 'utf8').catch(
        () => 'unavailable',
      );
      throw new Error(
        `${method} failed: ${JSON.stringify(value)}\nRoute file: ${routes}\n${apiOutput}`,
      );
    }
    return value.result.data.json;
  }
  function authRequest(path: string, body: unknown) {
    return fetch(`http://localhost:${apiPort}/api/auth/${path}`, {
      method: 'POST',
      headers: { origin: 'http://localhost:4200', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  function preview(
    label: string,
    slug = project.previewSlug,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolvePreview, reject) => {
      get(
        `http://127.0.0.1:${previewPort}`,
        { headers: { host: `${label}.${slug}.preview.localhost` } },
        (response) => {
          let body = '';
          response.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          response.on('end', () => resolvePreview({ status: response.statusCode ?? 0, body }));
          response.on('error', reject);
        },
      ).on('error', reject);
    });
  }
  async function inspectOrigin(id: string) {
    const result = await engine.request<{
      State: { Running: boolean };
      Config: { Image: string };
      Mounts: Array<{ Type: string; Name?: string; Destination: string; RW: boolean }>;
      HostConfig: {
        Memory: number;
        NanoCpus: number;
        LogConfig: { Config: Record<string, string> };
      };
    }>('GET', `/containers/senv-${instanceId}-${id}-origin/json`);
    return result.body;
  }
  async function ensureImage(image: string) {
    try {
      await engine.request('GET', `/images/${encodeURIComponent(image)}/json`);
    } catch {
      await engine.request('POST', `/images/create?fromImage=${encodeURIComponent(image)}`);
    }
  }
  async function startApi() {
    apiOutput = '';
    apiProcess = spawn(process.execPath, [resolve('dist/apps/api/server/index.mjs')], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DATABASE_URL: `file:${join(directory, 'senv.sqlite')}`,
        DEPLOYMENT_STORAGE_DIR: join(directory, 'deployments'),
        DEPLOYMENT_ARTIFACT_VOLUME: artifactVolume,
        BETTER_AUTH_SECRET: 'lifecycle-test-secret-at-least-32-characters',
        PORT: String(apiPort),
        ROOT_DOMAIN: 'localhost',
        API_URL: `http://localhost:${apiPort}`,
        APP_URL: 'http://localhost:4200',
        NODE_ENV: 'development',
        SENV_INSTANCE_ID: instanceId,
        PREVIEW_BASE_DOMAIN: 'preview.localhost',
        PREVIEW_TLS: 'false',
        PREVIEW_ENTRYPOINTS: 'web',
        PREVIEW_DYNAMIC_CONFIG: join(directory, 'deployments/senv-routes.yml'),
        PREVIEW_TRAEFIK_API_URL: `http://127.0.0.1:${traefikApiPort}`,
        DEPLOYMENT_STATIC_ORIGIN_IMAGE: 'nginx:alpine',
        DEPLOYMENT_PROXY_IMAGE: 'nginx:alpine',
      },
    });
    const appendOutput = (chunk: Buffer) => {
      apiOutput = (apiOutput + chunk.toString()).slice(-12_000);
    };
    apiProcess.stdout?.on('data', appendOutput);
    apiProcess.stderr?.on('data', appendOutput);
    await waitFor(async () => {
      if (apiProcess?.exitCode !== null) throw new Error(`API exited: ${apiOutput}`);
      try {
        return (await fetch(`http://localhost:${apiPort}/api/health`)).ok;
      } catch {
        return false;
      }
    });
  }
  async function stopApi() {
    const processToStop = apiProcess;
    if (!processToStop || processToStop.exitCode !== null) return;
    await new Promise<void>((done) => {
      const force = setTimeout(() => processToStop.kill('SIGKILL'), 8_000);
      processToStop.once('exit', () => {
        clearTimeout(force);
        done();
      });
      processToStop.kill('SIGTERM');
    });
    apiProcess = undefined;
  }
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Condition did not become true within ${timeoutMs}ms.`);
}
function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('No TCP port allocated.'));
        return;
      }
      server.close((error) => (error ? reject(error) : done(address.port)));
    });
  });
}
