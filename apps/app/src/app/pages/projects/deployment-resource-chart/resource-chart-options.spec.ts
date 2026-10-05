import type { DeploymentResourceHistory } from '@senv/api/shared/deployment-resources';
import { createChartScene, renderChartSvg } from '@tanstack/charts';
import { expect, test } from 'vite-plus/test';
import { resourceChartOptions } from './resource-chart-options';

const from = new Date('2026-10-04T08:40:00Z');
const to = new Date('2026-10-04T09:00:00Z');
const history: DeploymentResourceHistory = {
  from,
  to,
  intervalMs: 30_000,
  points: [0, 150, null, 30, 40].map((cpuPercent, index) => ({
    sampledAt: new Date(from.getTime() + (index + 1) * 30_000),
    cpuPercent,
    memoryUsedBytes: cpuPercent === null ? null : 256 * 1024 * 1024,
    memoryLimitBytes: 512 * 1024 * 1024,
  })),
};

test('plots real zero, allows CPU above 100%, preserves gaps and the full time window', () => {
  const options = resourceChartOptions(history, 'cpu');
  const scene = createChartScene(options.definition, {
    width: 480,
    height: 256,
  });
  expect(scene.points.map((point) => point.yValue)).toEqual([0, 150, 30, 40]);
  expect(scene.scales['x'].domain).toEqual([from.getTime(), to.getTime()]);
  expect(Number(scene.scales['y'].domain.at(-1))).toBeGreaterThanOrEqual(150);
  const document = new DOMParser().parseFromString(
    renderChartSvg(scene, options),
    'image/svg+xml',
  );
  const lines = [...document.querySelectorAll('path[stroke="var(--chart-1)"]')];
  expect(lines).toHaveLength(2);
  expect(
    document.querySelectorAll(
      'path[fill="var(--chart-1)"][fill-opacity="0.18"]',
    ),
  ).toHaveLength(2);
});

test('uses readable memory ticks and formats tooltips in bytes', () => {
  const options = resourceChartOptions(history, 'memory');
  const scene = createChartScene(options.definition, {
    width: 480,
    height: 256,
  });
  expect(scene.points[0].yValue).toBe(256);
  expect(
    scene.scales['y'].ticks.some((tick) => tick.label.includes('MiB')),
  ).toBe(true);
});
