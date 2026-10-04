import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vite-plus/test';
import { DeploymentRuntime, type RuntimeConfig } from './runtime';
import type { RuntimeServices } from './runtime';
import { FakeDocker } from './runtime-fake-docker';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

export function runtimeFixture(overrides: Partial<RuntimeConfig> = {}) {
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
