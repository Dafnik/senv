import { expect, test, vi } from 'vite-plus/test';
import { RESOURCE_SAMPLE_INTERVAL_MS } from '../../../../shared/deployment-resources';
import { runtimeFixture } from './runtime-test-support';

test('collects origin samples on start without a browser and records stopped-container gaps', async () => {
  const { runtime, services, config } = await runtimeFixture();
  const record = vi.spyOn(services, 'recordDeploymentResourceSample');
  const prune = vi.spyOn(services, 'pruneDeploymentResourceSamples');
  try {
    await runtime.start();
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      config.id,
      expect.objectContaining({ sampledAt: expect.any(Date) }),
    );
    expect(prune).toHaveBeenCalledOnce();
    config.desiredState = 'stopped';
    await runtime.reconcile();
    await runtime.collectResourceSamples();
    expect(record).toHaveBeenLastCalledWith(
      config.id,
      expect.objectContaining({ status: 'unavailable', reason: 'container-stopped' }),
    );
  } finally {
    runtime.stop();
  }
});

test('schedules collection at 30 seconds and cancels it on stop', async () => {
  const { runtime, services } = await runtimeFixture();
  const record = vi.spyOn(services, 'recordDeploymentResourceSample');
  await runtime.start();
  // Fake only timer APIs after startup to avoid delaying container reconciliation.
  runtime.stop();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    await runtime.start();
    record.mockClear();
    await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_INTERVAL_MS - 1);
    expect(record).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(record).toHaveBeenCalledOnce();
    runtime.stop();
    await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_INTERVAL_MS);
    expect(record).toHaveBeenCalledOnce();
  } finally {
    runtime.stop();
    vi.useRealTimers();
  }
});
