import type { ClientContext } from '../api/client.ts';
import type {
  DeploymentResourceHistory,
  OriginResourceSample,
} from '../../../api/shared/deployment-resources.ts';
import type { DetailBlock, Fact, Tone } from './detail-layout.ts';
import { layoutDetail, lineText } from './detail-layout.ts';
import { safeText } from './safety.ts';
import type { Row } from './types.ts';

type Client = ClientContext['client'];
type Deployment = Awaited<ReturnType<Client['deployments']['detail']['query']>>;
type Event = Awaited<ReturnType<Client['deployments']['history']['query']>>['entries'][number];

export function detailDocument(row: Row, document: DetailBlock[]): Row {
  return { ...row, document, lines: layoutDetail(document, 80).map(lineText) };
}

export function dateLabel(value: Date | string | number | null | undefined) {
  if (value === null || value === undefined) return 'Not yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function bytes(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable';
  if (value === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.max(
    0,
    Math.min(units.length - 1, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))),
  );
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function readable(value: string) {
  const text = safeText(value)
    .replace(
      /([a-z0-9])([A-Z])/g,
      (_, before: string, capital: string) => before + ' ' + capital.toLowerCase(),
    )
    .replace(/[-_]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function statusTone(status: string): Tone {
  if (['healthy', 'available'].includes(status)) return 'success';
  if (['failed', 'unhealthy'].includes(status)) return 'danger';
  if (['queued', 'starting'].includes(status)) return 'accent';
  return 'muted';
}

const statusDescriptions: Record<string, string> = {
  queued: 'Waiting for the origin container to start.',
  starting: 'Starting the origin container and checking its health.',
  healthy: 'The origin passed its health check.',
  unhealthy: 'The origin is running but its health check is failing.',
  failed: 'The deployment could not start. Check the failure reason and logs.',
  stopped: 'The origin is stopped. Restart it through actions when you are ready.',
  deleted: 'This deployment was deleted. Retained sources may still be reusable.',
  cleaned: 'Runtime resources and retained sources have been removed.',
};

export function overviewDocument(deployment: Deployment): DetailBlock[] {
  const kind = deployment.kind === 'static' ? 'Static site' : 'Container application';
  const blocks: DetailBlock[] = [
    {
      kind: 'banner',
      title: kind,
      status: readable(deployment.status),
      description: statusDescriptions[deployment.status] ?? readable(deployment.status),
      tone: statusTone(deployment.status),
    },
  ];
  if (deployment.failureReason)
    blocks.push(
      { kind: 'heading', title: 'Needs attention' },
      { kind: 'text', text: deployment.failureReason, tone: 'danger' },
    );
  blocks.push(
    { kind: 'heading', title: 'Deployment' },
    {
      kind: 'facts',
      columns: 2,
      items: [
        { label: 'Deployment ID', value: deployment.id },
        { label: 'Submitted', value: dateLabel(deployment.submittedAt) },
        { label: 'Ready', value: dateLabel(deployment.readyAt) },
        { label: 'Desired state', value: readable(deployment.desiredState ?? 'running') },
      ],
    },
    { kind: 'heading', title: 'Source' },
    {
      kind: 'facts',
      items: [
        { label: 'Repository', value: deployment.source.repository || 'Not provided' },
        { label: 'Branch', value: deployment.source.branch || 'Not provided' },
        { label: 'Commit', value: deployment.source.commit || 'Not provided' },
        ...(deployment.imageDigest
          ? [{ label: 'Image digest', value: deployment.imageDigest }]
          : []),
        {
          label: 'Reusable source',
          value:
            deployment.kind === 'static'
              ? deployment.artifactId
                ? 'Static artifact retained'
                : 'No retained artifact'
              : deployment.imageDigest
                ? 'Container image retained'
                : 'No retained image',
        },
      ],
    },
    { kind: 'heading', title: 'Retention & addresses' },
    {
      kind: 'facts',
      items: [
        {
          label: 'Pin',
          value: deployment.pinned ? 'Pinned. Protected from automatic expiry.' : 'Not pinned',
          tone: deployment.pinned ? 'accent' : 'normal',
        },
        {
          label: 'Expires',
          value: deployment.retentionDeadlineAt
            ? dateLabel(deployment.retentionDeadlineAt)
            : 'No expiry scheduled',
        },
        { label: 'Branch alias', value: deployment.branchAlias || 'None assigned' },
        {
          label: 'Tags',
          value: deployment.tags.length ? deployment.tags.join(', ') : 'None assigned',
        },
        ...(deployment.removalPending
          ? [{ label: 'Cleanup', value: 'Removal is in progress', tone: 'warning' as const }]
          : []),
      ],
    },
    {
      kind: 'text',
      text: 'Addresses has the full URLs. Use a for lifecycle, tag, and shell actions.',
      tone: 'muted',
    },
  );
  return blocks;
}

export function addressesDocument(addresses: {
  fixed: string;
  branch: string | null;
  tags: Array<{ name: string; url: string }>;
}): DetailBlock[] {
  return [
    { kind: 'heading', title: 'Fixed address', note: 'Always points to this deployment.' },
    { kind: 'text', text: addresses.fixed, tone: 'accent' },
    {
      kind: 'heading',
      title: 'Branch address',
      note: 'Points to the current deployment for this branch.',
    },
    {
      kind: 'text',
      text: addresses.branch ?? 'No branch address assigned.',
      tone: addresses.branch ? 'accent' : 'muted',
    },
    {
      kind: 'heading',
      title: 'Tag addresses',
      note: 'Tags can move to a different deployment through actions.',
    },
    ...(addresses.tags.length
      ? addresses.tags.flatMap((tag): DetailBlock[] => [
          { kind: 'facts', items: [{ label: tag.name, value: tag.url, tone: 'accent' }] },
        ])
      : [
          {
            kind: 'text' as const,
            text: 'No tags assigned. Use a to assign a preview tag.',
            tone: 'muted' as const,
          },
        ]),
  ];
}

export function resourcesDocument(sample: OriginResourceSample): DetailBlock[] {
  if (sample.status === 'unavailable') {
    const descriptions = {
      'container-missing':
        'The origin container does not exist. It may not have started or may have been removed.',
      'container-stopped':
        'The origin container is stopped. Resource usage is available while it is running.',
      'stats-unavailable': 'The origin did not return resource statistics. Press r to try again.',
    };
    return [
      {
        kind: 'banner',
        title: 'Origin resources',
        status: 'Unavailable',
        description: descriptions[sample.reason],
        tone: 'warning',
      },
      { kind: 'facts', items: [{ label: 'Checked', value: dateLabel(sample.sampledAt) }] },
    ];
  }
  return [
    { kind: 'heading', title: 'CPU' },
    {
      kind: 'meter',
      label: 'Usage',
      value: sample.cpuPercent,
      maximum: 100,
      display: `${sample.cpuPercent.toFixed(1)}%`,
      note: '100% is one CPU core. Multi-core usage can exceed 100%.',
    },
    { kind: 'heading', title: 'Memory' },
    {
      kind: 'meter',
      label: 'Used',
      value: sample.memoryUsedBytes,
      maximum: sample.memoryLimitBytes,
      display: bytes(sample.memoryUsedBytes),
      note: sample.memoryLimitBytes
        ? `Limit ${bytes(sample.memoryLimitBytes)}`
        : 'The origin did not report a memory limit.',
    },
    { kind: 'facts', items: [{ label: 'Sampled', value: dateLabel(sample.sampledAt) }] },
  ];
}

export function resourceHistoryDocument(history: DeploymentResourceHistory): DetailBlock[] {
  const cpu = history.points.map((point) => point.cpuPercent);
  const memory = history.points.map((point) => point.memoryUsedBytes);
  const peaks = (values: Array<number | null>) =>
    values.filter((value): value is number => value !== null && Number.isFinite(value));
  const cpuSamples = peaks(cpu);
  const memorySamples = peaks(memory);
  if (!cpuSamples.length && !memorySamples.length)
    return [
      { kind: 'heading', title: 'Resource history' },
      { kind: 'text', text: 'No resource samples available in this time window.', tone: 'muted' },
      {
        kind: 'text',
        text: `${dateLabel(history.from)} to ${dateLabel(history.to)}`,
        tone: 'muted',
      },
    ];
  return [
    {
      kind: 'heading',
      title: 'Resource history',
      note: `${dateLabel(history.from)} to ${dateLabel(history.to)}. Samples every ${history.intervalMs / 1000}s.`,
    },
    {
      kind: 'trend',
      label: 'CPU',
      values: cpu,
      summary: cpuSamples.length ? `peak ${Math.max(...cpuSamples).toFixed(1)}%` : 'No CPU samples',
    },
    {
      kind: 'trend',
      label: 'Memory',
      values: memory,
      summary: memorySamples.length
        ? `peak ${bytes(Math.max(...memorySamples))}`
        : 'No memory samples',
    },
    {
      kind: 'text',
      text: 'Each trend uses its own peak as the scale. Blank intervals have no sample.',
      tone: 'muted',
    },
    {
      kind: 'table',
      headings: ['Sampled (UTC)', 'CPU', 'Memory / limit'],
      rows: history.points.map((point) => [
        point.sampledAt.toISOString().slice(11, 19),
        point.cpuPercent === null ? 'Unavailable' : `${point.cpuPercent.toFixed(1)}%`,
        point.memoryUsedBytes === null
          ? 'Unavailable'
          : `${bytes(point.memoryUsedBytes)} / ${point.memoryLimitBytes ? bytes(point.memoryLimitBytes) : 'No limit'}`,
      ]),
    },
  ];
}

const hiddenField = /config|environment|^env$|password|secret|token|grant|credential|ciphertext/i;
function eventFacts(details: Record<string, unknown>, prefix = '', depth = 0): Fact[] {
  if (depth > 2) return [];
  return Object.entries(details)
    .flatMap(([key, value]): Fact[] => {
      if (hiddenField.test(key) || value === null || value === undefined) return [];
      const label = [prefix, readable(key)].filter(Boolean).join(' / ');
      if (value instanceof Date) return [{ label, value: dateLabel(value) }];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        return [
          { label, value: typeof value === 'boolean' ? (value ? 'Yes' : 'No') : safeText(value) },
        ];
      if (Array.isArray(value))
        return value.every((item) => typeof item === 'string' || typeof item === 'number')
          ? [{ label, value: value.map((item) => safeText(item)).join(', ') }]
          : [];
      if (typeof value === 'object')
        return eventFacts(value as Record<string, unknown>, label, depth + 1);
      return [];
    })
    .slice(0, 12);
}

export function eventsDocument(entries: Event[], empty: string): DetailBlock[] {
  if (!entries.length) return [{ kind: 'text', text: empty, tone: 'muted' }];
  return entries.map((entry) => ({
    kind: 'event',
    title: readable(entry.event),
    at: dateLabel(entry.createdAt),
    actor:
      entry.actorType === 'system'
        ? 'System'
        : entry.actor?.name || entry.actor?.id || 'Unknown actor',
    facts: eventFacts(entry.details ?? {}),
    tone: /fail|unhealthy|denied/.test(entry.event)
      ? 'danger'
      : /healthy|ready/.test(entry.event)
        ? 'success'
        : 'normal',
  }));
}

function logContent(content: string): { content: string; level?: string; tone?: Tone } {
  let record: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { content };
    record = value as Record<string, unknown>;
  } catch {
    return { content };
  }
  const message = record['msg'] ?? record['message'];
  if (typeof message !== 'string') return { content };
  const levels: Record<number, string> = {
    10: 'TRACE',
    20: 'DEBUG',
    30: 'INFO',
    40: 'WARN',
    50: 'ERROR',
    60: 'FATAL',
  };
  const level =
    typeof record['level'] === 'number'
      ? levels[record['level']]
      : typeof record['level'] === 'string'
        ? safeText(record['level']).toUpperCase()
        : undefined;
  const context = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !['msg', 'message', 'time', 'timestamp', 'level'].includes(key),
    ),
  );
  const attributes = eventFacts(context)
    .map((fact) => `${fact.label}=${fact.value}`)
    .join('  ');
  return {
    content: message + (attributes ? `\n${attributes}` : ''),
    level,
    tone:
      level && ['ERROR', 'FATAL'].includes(level)
        ? 'danger'
        : level && ['WARN', 'WARNING'].includes(level)
          ? 'warning'
          : undefined,
  };
}

export function logsDocument(
  entries: Array<{ createdAt: Date; sequence: number; content: string }>,
  older = false,
): DetailBlock[] {
  const blocks = entries.flatMap((entry) =>
    entry.content
      .replace(/\n$/, '')
      .split('\n')
      .map((content): DetailBlock => ({
        kind: 'log',
        at: entry.createdAt.toISOString().slice(11, 19),
        sequence: entry.sequence,
        ...logContent(safeText(content)),
      })),
  );
  return older ? blocks.slice(0, 5000) : blocks.slice(-5000);
}
