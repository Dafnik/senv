import type { DeploymentResourceHistory } from '@senv/api/shared/deployment-resources';
import { HLM_CHART_THEME, hlmChartTooltip } from '@spartan-ng/helm/chart';
import { defineChart, areaY } from '@tanstack/charts';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { formatBytes } from '../../../ui/format-bytes';

export type ResourceMetric = 'cpu' | 'memory';

export function resourceChartOptions(
  history: DeploymentResourceHistory,
  metric: ResourceMetric,
) {
  const cpu = metric === 'cpu';
  const title = cpu ? 'CPU' : 'Memory';
  const rows = history.points.map((point) => ({
    time: new Date(point.sampledAt).getTime(),
    value: cpu
      ? point.cpuPercent
      : point.memoryUsedBytes === null
        ? null
        : point.memoryUsedBytes / (1024 * 1024),
  }));
  const max = Math.max(cpu ? 100 : 1, ...rows.map((row) => row.value ?? 0));
  const from = new Date(history.from).getTime();
  const to = new Date(history.to).getTime();
  const time = (value: number, seconds = false) =>
    new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      ...(seconds ? { second: '2-digit' } : {}),
    });
  const value = (amount: number) =>
    cpu ? `${Number(amount.toFixed(1))}%` : formatBytes(amount * 1024 * 1024);
  return {
    height: 256,
    ariaLabel: `${title} usage over the last 20 minutes`,
    ariaDescription: `Samples every 30 seconds. ${cpu ? '100 percent represents one CPU core.' : 'Values show memory working set in bytes.'} Gaps indicate unavailable samples. Use arrow keys to explore samples.`,
    definition: defineChart({
      theme: { ...HLM_CHART_THEME, grid: 'var(--border)' },
      marks: [
        areaY(rows, {
          id: title,
          x: 'time',
          y: 'value',
          key: 'time',
          stroke: cpu ? 'var(--chart-1)' : 'var(--chart-2)',
          y1: 0,
          fill: cpu ? 'var(--chart-1)' : 'var(--chart-2)',
          fillOpacity: 0.18,
        }),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([from, to]),
          axis: {
            line: false,
            ticks: {
              size: 0,
              values: Array.from(
                { length: 5 },
                (_, index) => from + ((to - from) * index) / 4,
              ),
              format: (at: number) => time(at),
            },
          },
        },
        y: {
          scale: scaleLinear().domain([0, max]).nice(4),
          grid: true,
          axis: { line: false, ticks: { size: 0, count: 4, format: value } },
        },
      },
      focus: 'nearest-x',
      tooltip: hlmChartTooltip<
        { time: number; value: number | null },
        number,
        number
      >({
        content: (points) => ({
          title: points[0] ? time(points[0].xValue, true) : title,
          rows: points.map((point) => ({
            label: title,
            value: value(point.yValue),
            color: point.color,
          })),
        }),
      }),
    }),
  };
}
