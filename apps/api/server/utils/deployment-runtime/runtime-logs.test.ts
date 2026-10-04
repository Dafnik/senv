import { expect, test } from 'vite-plus/test';
import { join } from 'node:path';
import { dockerFrame, dockerFrameBytes } from './runtime-fake-docker';
import { runtimeFixture } from './runtime-test-support';

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

test('removing a deployment forgets its saved log cursors', async () => {
  const { runtime, engine, getRemovalHandler, root } = await runtimeFixture();
  try {
    await runtime.start();
    engine.logPayloads.push(dockerFrame('2026-10-03T00:00:00.123456789Z output\n'));
    await runtime.collectLogs();
    const cursorPath = join(root, 'log-cursors.json');
    const saved = JSON.parse(
      await (await import('node:fs/promises')).readFile(cursorPath, 'utf8'),
    ) as Record<string, number>;
    expect(saved['dpl-runtime-test:origin']).toBeGreaterThan(0);

    await getRemovalHandler()('dpl-runtime-test', 'project');

    expect(
      JSON.parse(await (await import('node:fs/promises')).readFile(cursorPath, 'utf8')),
    ).toEqual({});
  } finally {
    runtime.stop();
  }
});

test('keeps repeated continuation fragments from distinct log records and deduplicates overlapping polls', async () => {
  const { runtime, engine, logRows } = await runtimeFixture();
  try {
    await runtime.start();
    const first = `2026-10-03T00:00:00.123456789Z ${'x'.repeat(80000)}\n`;
    const second = `2026-10-03T00:00:01.123456789Z ${'x'.repeat(80000)}\n`;
    engine.logPayloads.push(dockerFrame(first + second));
    await runtime.collectLogs();
    expect(logRows.map((row) => row.content).join('')).toBe(first + second);
    // A second poll includes the last record because the persisted timestamp is rounded down.
    engine.logPayloads.push(dockerFrame(second));
    await runtime.collectLogs();
    expect(logRows.map((row) => row.content).join('')).toBe(first + second);
  } finally {
    runtime.stop();
  }
});

test('preserves duplicate complete Docker records sharing a timestamp across overlapping polls', async () => {
  const { runtime, engine, logRows } = await runtimeFixture();
  try {
    await runtime.start();
    const record = '2026-10-03T00:00:00.123456789Z duplicate\n';
    engine.logPayloads.push(dockerFrame(record + record));
    await runtime.collectLogs();
    engine.logPayloads.push(dockerFrame(record + record));
    await runtime.collectLogs();
    expect(logRows.map((row) => row.content).join('')).toBe(record + record);
  } finally {
    runtime.stop();
  }
});
