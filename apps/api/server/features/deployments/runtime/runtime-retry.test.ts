import { expect, test, vi } from 'vite-plus/test';
import { runtimeFixture } from './runtime-test-support';

test('a startup failure retries Docker stop without restarting a failed workload', async () => {
  const { runtime, engine, config, containers } = await runtimeFixture({
    health: {
      path: '/',
      startupDeadlineSeconds: 0,
      intervalSeconds: 0.01,
      timeoutSeconds: 1,
      unhealthyThreshold: 2,
    },
  });
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    engine.probeStatuses.push(503);
    engine.failStop = true;
    await runtime.start();
    expect(config.status).toBe('failed');
    expect(config.desiredState).toBe('running');
    expect(containers().every((container) => container.running)).toBe(true);
    expect(diagnostic).toHaveBeenCalledWith(
      expect.stringContaining('reconciliation failed'),
      expect.any(Error),
    );
    const containerCreates = engine.requests.filter((request) =>
      request.startsWith('POST /containers/create?'),
    ).length;

    engine.failStop = false;
    await runtime.reconcile();
    expect(config.status).toBe('failed');
    expect(containers().every((container) => !container.running)).toBe(true);
    expect(
      engine.requests.filter((request) => request.startsWith('POST /containers/create?')),
    ).toHaveLength(containerCreates);
  } finally {
    runtime.stop();
    diagnostic.mockRestore();
  }
});

test('failed deployments with stopped intent retry stop after a Docker error', async () => {
  const { runtime, engine, config, containers } = await runtimeFixture();
  try {
    await runtime.start();
    config.status = 'failed';
    config.desiredState = 'stopped';
    engine.failStop = true;
    await runtime.reconcile();
    expect(containers().every((container) => container.running)).toBe(true);

    engine.failStop = false;
    await runtime.reconcile();
    expect(containers().every((container) => !container.running)).toBe(true);
  } finally {
    runtime.stop();
  }
});

test('an ownership log error does not starve later deployment logs', async () => {
  const { runtime, engine, config, services, containers } = await runtimeFixture();
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await runtime.start();
    containers().find((container) => container.labels['senv.role'] === 'origin')!.labels[
      'senv.project'
    ] = 'foreign-project';
    const second = {
      ...config,
      id: 'dpl-second',
      status: 'healthy' as const,
    };
    services.listDeploymentRuntimeConfigs = () => [config, second];
    const name = 'senv-test-dpl-second-origin';
    const secondOrigin = {
      id: 'second-origin-id',
      name,
      running: true,
      labels: {
        'senv.managed': 'true',
        'senv.instance': 'test',
        'senv.project': 'project',
        'senv.deployment': 'dpl-second',
        'senv.role': 'origin',
      },
    };
    engine.containers.set(name, secondOrigin);
    engine.containers.set(secondOrigin.id, secondOrigin);

    await runtime.collectLogs();

    expect(diagnostic).toHaveBeenCalledWith(
      expect.stringContaining('log collection failed for deployment'),
      expect.any(Error),
    );
    expect(
      engine.streamPaths.some((path) => path.startsWith('/containers/second-origin-id/logs?')),
    ).toBe(true);
    expect(config.status).toBe('failed');
    expect(config.desiredState).toBe('stopped');
  } finally {
    runtime.stop();
    diagnostic.mockRestore();
  }
});
