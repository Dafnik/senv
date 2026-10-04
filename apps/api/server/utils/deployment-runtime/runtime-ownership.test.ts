import { expect, test, vi } from 'vite-plus/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeFixture } from './runtime-test-support';

test('same-name containers with mismatched ownership are never adopted, probed, or logged', async () => {
  const { runtime, engine, config } = await runtimeFixture();
  const name = 'senv-test-dpl-runtime-test-proxy';
  const collision = {
    id: 'unrelated-container',
    name,
    running: true,
    labels: {
      'senv.managed': 'true',
      'senv.instance': 'test',
      'senv.deployment': 'another-deployment',
      'senv.project': 'another-project',
      'senv.role': 'proxy',
    },
  };
  engine.containers.set(name, collision);
  engine.containers.set(collision.id, collision);
  await runtime.start();
  expect(config.status).toBe('failed');
  expect(config.desiredState).toBe('stopped');
  const before = engine.requests.length;
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  await runtime.collectLogs();
  expect(diagnostic).toHaveBeenCalledWith(
    expect.stringContaining('log collection failed for deployment'),
    expect.any(Error),
  );
  diagnostic.mockRestore();
  expect(engine.containers.get(name)).toBe(collision);
  expect(engine.requests.slice(before).some((request) => request.includes('/exec'))).toBe(false);
  expect(engine.streamPaths).toEqual([]);
  expect(engine.requests.some((request) => request.startsWith('DELETE /containers/'))).toBe(false);
  runtime.stop();
});

test('each ownership label independently protects both same-name container roles', async () => {
  const labelMutations = [
    ['senv.managed', 'false'],
    ['senv.instance', 'another-instance'],
    ['senv.project', 'another-project'],
    ['senv.deployment', 'another-deployment'],
  ] as const;
  for (const role of ['origin', 'proxy'] as const) {
    for (const [label, value] of [
      ...labelMutations,
      ['senv.role', role === 'origin' ? 'proxy' : 'origin'] as const,
    ]) {
      const { runtime, engine, config } = await runtimeFixture();
      const name = `senv-test-dpl-runtime-test-${role}`;
      const collision = {
        id: `collision-${role}-${label}`,
        name,
        running: true,
        labels: {
          'senv.managed': 'true',
          'senv.instance': 'test',
          'senv.project': 'project',
          'senv.deployment': 'dpl-runtime-test',
          'senv.role': role,
          [label]: value,
        },
      };
      engine.containers.set(name, collision);
      engine.containers.set(collision.id, collision);
      await runtime.start();
      expect(config.status).toBe('failed');
      expect(config.desiredState).toBe('stopped');
      expect(engine.containers.get(name)).toBe(collision);
      expect(engine.requests.some((request) => request.startsWith('DELETE /containers/'))).toBe(
        false,
      );
      expect(engine.requests.some((request) => request.includes('/exec'))).toBe(false);
      expect(engine.streamPaths).toEqual([]);
      runtime.stop();
    }
  }
});

test('healthy probes and log collection retire deployments whose ownership later changes', async () => {
  for (const role of ['origin', 'proxy'] as const) {
    const { runtime, engine, containers, config } = await runtimeFixture();
    await runtime.start();
    const container = containers().find((item) => item.labels['senv.role'] === role)!;
    const executions = engine.requests.filter((request) => request.includes('/exec')).length;
    container.labels['senv.project'] = 'foreign-project';
    await runtime.reconcile();
    expect(config.status).toBe('failed');
    expect(config.desiredState).toBe('stopped');
    expect(engine.requests.filter((request) => request.includes('/exec'))).toHaveLength(executions);
    await runtime.collectLogs();
    expect(engine.streamPaths.some((path) => path.includes(`/${container.id}/logs`))).toBe(false);
    runtime.stop();
  }
});

test('Docker stop errors remain visible to reconciliation and a later retry can stop both containers', async () => {
  const { runtime, engine, config, containers } = await runtimeFixture();
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await runtime.start();
    config.desiredState = 'stopped';
    engine.failStop = true;
    await runtime.reconcile();
    expect(containers().every((container) => container.running)).toBe(true);
    expect(diagnostic).toHaveBeenCalledWith(
      expect.stringContaining('reconciliation failed'),
      expect.any(Error),
    );
    engine.failStop = false;
    await runtime.reconcile();
    expect(containers().every((container) => !container.running)).toBe(true);
  } finally {
    runtime.stop();
    diagnostic.mockRestore();
  }
});

test('reconciliation still starts active deployments when removal cleanup fails', async () => {
  const { runtime, services, containers } = await runtimeFixture();
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  services.resumePendingDeploymentRemovals = async () => {
    throw new Error('pending removal failed');
  };
  services.cleanupDueDeployments = async () => {
    throw new Error('due cleanup failed');
  };
  try {
    await runtime.start();
    expect(containers()).toHaveLength(2);
    expect(containers().every((container) => container.running)).toBe(true);
    expect(diagnostic).toHaveBeenCalledWith(
      '[deployment-runtime] pending deployment removal retry failed',
      expect.any(Error),
    );
  } finally {
    runtime.stop();
    diagnostic.mockRestore();
  }
});

test('pending removal recovery preserves unrelated persisted log cursors', async () => {
  const { runtime, services, getRemovalHandler, config, root } = await runtimeFixture();
  const cursorFile = join(root, 'log-cursors.json');
  await writeFile(
    cursorFile,
    JSON.stringify({ 'dpl-runtime-test:origin': 10, 'unrelated-deployment:proxy': 20 }),
  );
  services.resumePendingDeploymentRemovals = async () => {
    await getRemovalHandler()(config.id, config.projectId);
    return 1;
  };
  await runtime.start();
  expect(JSON.parse(await readFile(cursorFile, 'utf8'))).toEqual({
    'unrelated-deployment:proxy': 20,
  });
  runtime.stop();
});

test('static artifact installation rejects metadata owned by another project', async () => {
  const { runtime, config, artifact, lastArtifactProjectId, containers } = await runtimeFixture();
  artifact.projectId = 'foreign-project';
  await runtime.start();
  expect(lastArtifactProjectId()).toBe(config.projectId);
  expect(config.status).toBe('failed');
  expect(containers()).toHaveLength(0);
  runtime.stop();
});
