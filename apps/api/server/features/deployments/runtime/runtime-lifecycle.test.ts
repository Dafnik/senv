import { expect, test } from 'vite-plus/test';

import { runtimeFixture } from './runtime-test-support';

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

test('deletion waits for an in-flight start and prevents its containers from surviving', async () => {
  const { runtime, engine, getRemovalHandler, containers } = await runtimeFixture();
  const gate = await engine.createContainerGate();
  try {
    const starting = runtime.start();
    await gate.waitForEntry;
    const removing = getRemovalHandler()('dpl-runtime-test', 'project');
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
