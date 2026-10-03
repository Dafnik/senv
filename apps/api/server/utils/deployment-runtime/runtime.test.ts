import { mkdtemp, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';
import { DockerEngine, type DockerResponse } from '../docker-engine';
import { DeploymentRuntime, type RuntimeConfig } from './runtime';
import type { RuntimeServices } from './runtime';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeDocker extends DockerEngine {
  readonly containers = new Map<
    string,
    { id: string; name: string; running: boolean; labels: Record<string, string> }
  >();
  readonly images = new Set<string>();
  readonly execs = new Map<string, number>();
  readonly requests: string[] = [];
  readonly logPayloads: Buffer[] = [];
  readonly streamPaths: string[] = [];
  networkReady = false;
  unavailable = false;
  probeStatuses: number[] = [];
  redirectProbe = false;
  createGate?: { entered: Promise<void>; release: () => void };
  #containerSequence = 0;
  #execSequence = 0;

  override async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<DockerResponse<T>> {
    this.requests.push(`${method} ${path}`);
    if (this.unavailable) throw new Error('Docker daemon is unavailable.');
    let value: unknown = {};
    if (path.startsWith('/networks?'))
      value = this.networkReady ? [{ Id: 'network-1', Name: 'senv-preview-test' }] : [];
    else if (path === '/networks/create') this.networkReady = true;
    else if (path === '/networks/network-1')
      value = { Id: 'network-1', Labels: { 'senv.instance': 'test' } };
    else if (path.startsWith('/images/create'))
      this.images.add(
        new URLSearchParams(path.split('?')[1]).get('fromImage') ?? 'nginx:1.27-alpine',
      );
    else if (path.startsWith('/images/')) {
      const image = decodeURIComponent(path.split('/')[2]!.replace(/\/json.*$/, ''));
      if (!this.images.has(image))
        throw new Error('Docker Engine GET image failed (404): not found');
      value = { RepoDigests: [`${image}@sha256:${'a'.repeat(64)}`] };
    } else if (path.startsWith('/containers/create?')) {
      if (this.createGate) {
        this.createGate.release = this.createGate.release.bind(this.createGate);
        await this.createGate.entered;
      }
      const name = new URLSearchParams(path.split('?')[1]).get('name')!;
      const config = body as { Labels: Record<string, string> };
      const id = `container-${++this.#containerSequence}`;
      this.containers.set(name, { id, name, running: false, labels: config.Labels });
      this.containers.set(id, this.containers.get(name)!);
      value = { Id: id };
    } else if (path.startsWith('/containers/') && path.endsWith('/json')) {
      const key = decodeURIComponent(path.slice('/containers/'.length, -'/json'.length));
      const container = this.containers.get(key);
      if (!container) throw new Error('Docker Engine GET container failed (404): not found');
      value = this.inspect(container);
    } else if (path.startsWith('/containers/') && path.endsWith('/start')) {
      const container = this.containerFromPath(path);
      container.running = true;
    } else if (path.startsWith('/containers/') && path.includes('/stop')) {
      this.containerFromPath(path).running = false;
    } else if (path.startsWith('/containers/') && method === 'DELETE') {
      const container = this.containerFromPath(path);
      this.containers.delete(container.name);
      this.containers.delete(container.id);
    } else if (path.startsWith('/containers/json')) value = [];
    else if (path.startsWith('/containers/') && path.endsWith('/exec'))
      value = { Id: `exec-${++this.#execSequence}` };
    else if (path.startsWith('/exec/') && path.endsWith('/start')) {
      const code = this.probeStatuses.shift() ?? 200;
      this.execs.set(path.split('/')[2]!, code);
      const statusLines = this.redirectProbe
        ? `HTTP/1.1 302 Found\r\nLocation: https://elsewhere.test/\r\nHTTP/1.1 200 OK\r\n`
        : `HTTP/1.1 ${code} ${code === 200 ? 'OK' : 'Service Unavailable'}\r\n`;
      value = dockerFrame(statusLines);
    } else if (path.startsWith('/exec/') && path.endsWith('/json')) {
      const code = this.execs.get(path.split('/')[2]!) ?? 200;
      value = { ExitCode: code >= 200 && code < 400 ? 0 : 1 };
    }
    return { status: 200, headers: {}, body: value as T };
  }

  override async uploadFile(): Promise<void> {}
  override async stream(_method: string, path: string): Promise<IncomingMessage> {
    this.streamPaths.push(path);
    const payload = this.logPayloads.shift() ?? dockerFrame('');
    return Readable.from([
      payload.subarray(0, 2),
      payload.subarray(2),
    ]) as unknown as IncomingMessage;
  }

  async createContainerGate(): Promise<{ waitForEntry: Promise<void>; release: () => void }> {
    let entered!: () => void;
    let release!: () => void;
    const waitForEntry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.createGate = { entered: waitForEntry, release: entered };
    const original = this.request.bind(this);
    this.request = async <T = unknown>(method: string, path: string, body?: unknown) => {
      if (path.startsWith('/containers/create?') && this.createGate) {
        this.createGate.release();
        await released;
        this.createGate = undefined;
      }
      return original<T>(method, path, body);
    };
    return { waitForEntry, release };
  }

  private containerFromPath(path: string) {
    const key = decodeURIComponent(path.slice('/containers/'.length).split(/[/?]/)[0]!);
    const container = this.containers.get(key);
    if (!container) throw new Error(`container ${key} not found`);
    return container;
  }

  private inspect(container: {
    id: string;
    name: string;
    running: boolean;
    labels: Record<string, string>;
  }) {
    return {
      Id: container.id,
      State: {
        Running: container.running,
        Status: container.running ? 'running' : 'exited',
        ExitCode: 0,
      },
      Config: { Labels: container.labels, Image: 'nginx:1.27-alpine' },
    };
  }
}

function dockerFrame(text: string): Buffer {
  return dockerFrameBytes(Buffer.from(text));
}

function dockerFrameBytes(payload: Buffer): Buffer {
  const frame = Buffer.alloc(8 + payload.length);
  frame[0] = 1;
  frame.writeUInt32BE(payload.length, 4);
  payload.copy(frame, 8);
  return frame;
}

function runtimeFixture(overrides: Partial<RuntimeConfig> = {}) {
  const rootPromise = mkdtemp(join(tmpdir(), 'senv-runtime-test-'));
  return rootPromise.then(async (root) => {
    roots.push(root);
    const config: RuntimeConfig = {
      id: 'dpl-runtime-test',
      projectId: 'project',
      kind: 'static',
      artifactId: null,
      port: 80,
      env: {},
      secrets: {},
      health: {
        path: '/',
        startupDeadlineSeconds: 30,
        intervalSeconds: 0.01,
        timeoutSeconds: 1,
        unhealthyThreshold: 2,
      },
      spaFallback: false,
      proxy: { routes: [], cacheRules: [], compression: { enabled: true, endings: [] } },
      limits: {
        origin: { cpus: '0.5', memoryBytes: 64 * 1024 * 1024 },
        proxy: { cpus: '0.1', memoryBytes: 32 * 1024 * 1024 },
      },
      logs: { files: 3, fileSizeBytes: 10 * 1024 * 1024 },
      desiredState: 'running',
      status: 'queued',
      submittedAt: new Date(),
      ...overrides,
    };
    const engine = new FakeDocker();
    let removalHandler: ((id: string) => Promise<void>) | undefined;
    const artifact = {
      id: 'artifact',
      kind: 'static' as const,
      storageKey: '0'.repeat(64),
      sha256: '0'.repeat(64),
      size: 5,
    };
    const services = {
      registerPreviewRoutesRefresh: () => {},
      resumePendingDeploymentRemovals: async () => 0,
      registerDeploymentRemovalHandler: (callback: (id: string) => Promise<void>) => {
        removalHandler = callback;
      },
      getPreviewRouteTargets: () => ({
        baseDomain: 'preview.localhost',
        deployments: [],
        branches: [],
        tags: [],
      }),
      cleanupDueDeployments: async () => 0,
      listDeploymentRuntimeConfigs: () => [config],
      getDeploymentRuntimeConfig: () => config,
      markDeploymentStarting: async () => {
        if (
          config.desiredState !== 'running' ||
          !['queued', 'starting', 'healthy', 'unhealthy'].includes(config.status)
        )
          return null;
        config.status = 'starting';
        return { ...config };
      },
      markDeploymentReady: async () => {
        if (config.desiredState === 'running') config.status = 'healthy';
      },
      markDeploymentFailed: async () => {
        if (config.desiredState === 'running') config.status = 'failed';
      },
      setDeploymentHealth: async (_id: string, status: 'healthy' | 'unhealthy') => {
        config.status = status;
      },
      getArtifact: async () => artifact,
      setDeploymentImageDigest: async () => {},
      getArtifactCleanupState: () => ({
        referenced: [artifact.storageKey],
        pending: [],
        released: [],
      }),
      forgetArtifactStorageKey: () => false,
      appendDeploymentLog: (_id: string, source: 'proxy' | 'origin', content: string) =>
        logRows.push({ source, content }),
    } satisfies RuntimeServices;
    const logRows: Array<{ source: 'proxy' | 'origin'; content: string }> = [];
    const runtime = new DeploymentRuntime({
      engine,
      root,
      instanceId: 'test',
      networkName: 'senv-preview-test',
      services,
      pollIntervalMs: 60_000,
      logPollIntervalMs: 60_000,
      tls: false,
    });
    await runtime.artifacts.initialize();
    const saved = await runtime.artifacts.ingestFiles([
      { name: 'index.html', data: Buffer.from('index') },
    ]);
    artifact.storageKey = saved.storageKey;
    config.artifactId = artifact.id;
    return {
      runtime,
      engine,
      config,
      services,
      logRows,
      root,
      getRemovalHandler: () => removalHandler!,
      containers: () => [
        ...new Map(
          [...engine.containers.values()].map((container) => [container.id, container]),
        ).values(),
      ],
    };
  });
}

test('reconciles a static deployment through healthy, unhealthy recovery, stop, and restart', async () => {
  const { runtime, engine, config } = await runtimeFixture();
  try {
    await runtime.start();
    expect(config.status).toBe('healthy');
    expect([
      ...new Set([...engine.containers.values()].map((container) => container.id)),
    ]).toHaveLength(2);

    engine.probeStatuses.push(503, 503);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await runtime.reconcile();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await runtime.reconcile();
    expect(config.status).toBe('unhealthy');

    engine.probeStatuses.push(200, 200);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await runtime.reconcile();
    expect(config.status).toBe('healthy');

    config.desiredState = 'stopped';
    config.status = 'stopped';
    await runtime.reconcile();
    expect(
      [
        ...new Map(
          [...engine.containers.values()].map((container) => [container.id, container]),
        ).values(),
      ].every((container) => !container.running),
    ).toBe(true);

    config.desiredState = 'running';
    config.status = 'queued';
    await runtime.reconcile();
    expect(config.status).toBe('healthy');
  } finally {
    runtime.stop();
  }
});

test('a redirect response cannot satisfy the owned origin readiness probe', async () => {
  const { runtime, engine, config } = await runtimeFixture({
    health: {
      path: '/',
      startupDeadlineSeconds: 0,
      intervalSeconds: 0.01,
      timeoutSeconds: 1,
      unhealthyThreshold: 1,
    },
  });
  engine.redirectProbe = true;
  try {
    await runtime.start();
    expect(config.status).toBe('failed');
  } finally {
    runtime.stop();
  }
});

test('a stale stopped snapshot returned by markStarting does not create containers', async () => {
  const { runtime, engine, config } = await runtimeFixture({ status: 'stopped' });
  try {
    await runtime.start();
    expect(config.status).toBe('stopped');
    expect(engine.requests.some((request) => request.startsWith('POST /containers/create?'))).toBe(
      false,
    );
  } finally {
    runtime.stop();
  }
});

test('streams full bounded log frames from stopped containers and persists the cursor', async () => {
  const { runtime, engine, config, logRows, root } = await runtimeFixture();
  try {
    await runtime.start();
    config.desiredState = 'stopped';
    config.status = 'stopped';
    await runtime.reconcile();
    const emoji = Buffer.from('💡');
    const parts = [
      dockerFrameBytes(Buffer.from(`2026-10-03T00:00:00.123456789Z ${'x'.repeat(150_000)}`)),
      dockerFrameBytes(emoji.subarray(0, 2)),
      dockerFrameBytes(Buffer.concat([emoji.subarray(2), Buffer.from('\n')])),
    ];
    const payload = Buffer.concat(parts);
    engine.logPayloads.push(payload, payload);
    await runtime.collectLogs();
    expect(logRows.length).toBeGreaterThan(2);
    const collected = logRows.map((row) => row.content).join('');
    expect(collected.match(/x/g)).toHaveLength(300_000);
    expect(collected.match(/💡/g)).toHaveLength(2);
    expect(collected.endsWith('\n')).toBe(true);
    expect(engine.streamPaths.every((path) => path.includes('tail=all'))).toBe(true);
    const cursors = JSON.parse(
      await (await import('node:fs/promises')).readFile(join(root, 'log-cursors.json'), 'utf8'),
    ) as Record<string, number>;
    expect(cursors['dpl-runtime-test:origin']).toBeGreaterThan(0);
    expect(cursors['dpl-runtime-test:proxy']).toBeGreaterThan(0);
  } finally {
    runtime.stop();
  }
});

test('deletion waits for an in-flight start and prevents its containers from surviving', async () => {
  const { runtime, engine, getRemovalHandler, containers } = await runtimeFixture();
  const gate = await engine.createContainerGate();
  try {
    const starting = runtime.start();
    await gate.waitForEntry;
    const removing = getRemovalHandler()('dpl-runtime-test');
    gate.release();
    await Promise.all([starting, removing]);
    expect(containers()).toHaveLength(0);
  } finally {
    runtime.stop();
  }
});

for (const status of ['queued', 'starting'] as const) {
  test(`retries ${status} deployments after a temporary Docker outage`, async () => {
    const { runtime, engine, config, containers } = await runtimeFixture({ status });
    engine.unavailable = true;
    try {
      await runtime.start();
      expect(config.status).toBe(status);
      expect(containers()).toHaveLength(0);
      engine.unavailable = false;
      await runtime.reconcile();
      expect(config.status).toBe('healthy');
      expect(containers()).toHaveLength(2);
    } finally {
      runtime.stop();
    }
  });
}
