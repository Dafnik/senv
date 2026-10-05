import { expect, test, vi } from 'vite-plus/test';
import stringWidth from 'string-width';
import { CliError } from '../errors.ts';
import type { ClientContext } from '../api/client.ts';
import {
  addressesDocument,
  bytes,
  eventsDocument,
  logsDocument,
  overviewDocument,
  resourceHistoryDocument,
  resourcesDocument,
} from './deployment-detail.ts';
import { layoutDetail, lineText } from './detail-layout.ts';
import { loadDeployment } from './workspace.ts';

type Deployment = Awaited<ReturnType<ClientContext['client']['deployments']['detail']['query']>>;
const at = new Date('2026-10-05T10:12:34Z');
const deployment = {
  id: 'deploy-123',
  kind: 'static',
  status: 'healthy',
  desiredState: 'running',
  pinned: true,
  submittedAt: at,
  readyAt: at,
  artifactId: 'artifact',
  failureReason: null,
  retentionDeadlineAt: null,
  branchAlias: 'main',
  tags: ['production'],
  previewUrl: 'https://deploy-123.website.example.com',
  source: {
    repository: 'https://github.com/example/website',
    branch: 'main',
    commit: '1234567890abcdef',
  },
  config: { env: { PRIVATE: 'must-not-appear' } },
} as unknown as Deployment;
const history: Parameters<typeof eventsDocument>[0] = [
  {
    id: 'event',
    deploymentId: 'deploy-123',
    projectId: 'project',
    createdAt: at,
    event: 'tag-assigned',
    actorType: 'user',
    actor: { id: 'user', name: 'Dafni' },
    details: { name: 'production' },
  },
];
const text = (blocks: Parameters<typeof layoutDetail>[0], width = 76, query = '') =>
  layoutDetail(blocks, width, query).map(lineText).join('\n');

test('overview prioritizes health, source, and retention with human labels and no configuration dump', () => {
  const output = text(overviewDocument(deployment));
  expect(output).toContain('[ HEALTHY ]  Static site');
  expect(output).toContain('The origin passed its health check.');
  expect(output).toContain('Repository');
  expect(output).toContain('Static artifact retained');
  expect(output).toContain('Protected from automatic expiry.');
  expect(output).not.toContain('must-not-appear');
  expect(output).not.toContain('desiredState');
  expect(output).not.toContain('artifactId');
  expect(
    text(
      overviewDocument({
        ...deployment,
        status: 'failed',
        failureReason: 'Image could not be pulled.',
      }),
    ),
  ).toContain('Image could not be pulled.');
});

test('address layout preserves complete long URLs and gives missing aliases clear empty states', () => {
  const url = 'https://deployment.very-long-project-name.preview.example.com/path';
  const output = text(addressesDocument({ fixed: url, branch: null, tags: [] }), 36);
  expect(output.replaceAll('\n', '')).toContain(url);
  expect(output).toContain('FIXED ADDRESS');
  expect(output).not.toContain('fixed:');
  expect(output.replaceAll('\n', '')).toContain('No branch address assigned.');
});

test('resource meters use readable units and preserve CPU usage above one core', () => {
  const output = text(
    resourcesDocument({
      status: 'available',
      sampledAt: at,
      cpuPercent: 180.5,
      memoryUsedBytes: 512 * 1024 ** 2,
      memoryLimitBytes: 1024 ** 3,
    }),
  );
  expect(output).toContain('180.5%');
  expect(output).toContain('512.0 MiB');
  expect(output).toContain('Limit 1.0 GiB');
  expect(output).toContain('50.0%');
  expect(output).not.toContain('memoryUsedBytes');
  expect(bytes(0)).toBe('0 B');
  const unlimited = text(
    resourcesDocument({
      status: 'available',
      sampledAt: at,
      cpuPercent: 0,
      memoryUsedBytes: 512,
      memoryLimitBytes: null,
    }),
  );
  expect(unlimited).toContain('did not report a memory limit');
});

for (const reason of ['container-missing', 'container-stopped', 'stats-unavailable'] as const) {
  test(`unavailable resources explain ${reason}`, () => {
    const output = text(resourcesDocument({ status: 'unavailable', sampledAt: at, reason }));
    expect(output).toContain('[ UNAVAILABLE ]');
    expect(output).not.toContain(reason);
    expect(output).not.toContain('#');
  });
}

test('historical metrics distinguish zero samples from gaps and render readable sample tables', () => {
  const history = {
    from: at,
    to: at,
    intervalMs: 30_000,
    points: [
      { sampledAt: at, cpuPercent: 0, memoryUsedBytes: 0, memoryLimitBytes: null },
      { sampledAt: at, cpuPercent: null, memoryUsedBytes: null, memoryLimitBytes: null },
      {
        sampledAt: at,
        cpuPercent: 25,
        memoryUsedBytes: 64 * 1024 ** 2,
        memoryLimitBytes: 1024 ** 3,
      },
    ],
  };
  const output = text(resourceHistoryDocument(history));
  expect(output).toContain('peak 25.0%');
  expect(output).toContain('peak 64.0 MiB');
  expect(output).toContain('0 B / No limit');
  expect(output).toContain('Unavailable');
  expect(text(resourceHistoryDocument({ ...history, points: [] }))).toContain(
    'No resource samples',
  );
});

test('audit entries read as events, retain actors during search, and exclude private fields', () => {
  const events = [
    {
      ...history[0]!,
      details: {
        name: 'production',
        oldTarget: 'previous',
        config: { PRIVATE: 'must-not-appear' },
      },
    },
  ];
  const output = text(eventsDocument(events, 'No events'), 76, 'production');
  expect(output).toContain('Tag assigned');
  expect(output).toContain('Dafni');
  expect(output).toContain('2026-10-05 10:12:34 UTC');
  expect(output).toContain('Old target');
  expect(output).not.toContain('must-not-appear');
  expect(output).not.toContain('actorType');
  expect(text(eventsDocument([], 'No events'))).toBe('No events');
});

test('logs format known JSON messages and keep unrecognized application output intact', () => {
  const document = logsDocument([
    {
      createdAt: at,
      sequence: 1,
      content:
        '{"level":50,"msg":"Connection failed","port":8080}\nplain output\n{"custom":"payload"}\n',
    },
  ]);
  const output = text(document);
  expect(output).toContain('10:12:34  ERROR Connection failed');
  expect(output).toContain('Port=8080');
  expect(output).toContain('plain output');
  expect(output).toContain('{"custom":"payload"}');
  expect(output).not.toContain('"msg"');
  expect(document[0]).toMatchObject({ kind: 'log', tone: 'danger' });
});

test('structured layout keeps wrapped Unicode, tables, and terminal control characters within bounds', () => {
  const blocks = [
    ...overviewDocument({
      ...deployment,
      source: {
        ...deployment.source,
        repository: '\u001b[31mhttps://example.com/部署/very-long-repository-name',
      },
    }),
    ...logsDocument([{ createdAt: at, sequence: 1, content: 'Long line ' + '部署'.repeat(50) }]),
    {
      kind: 'table' as const,
      headings: ['Time', 'Memory', 'Status'],
      rows: [['10:12:34', '512.0 MiB / 1.0 GiB', 'A long status that must wrap completely']],
    },
  ];
  for (const width of [36, 56, 76, 116]) {
    const lines = layoutDetail(blocks, width);
    expect(lines.every((line) => stringWidth(lineText(line)) <= width)).toBe(true);
    expect(lines.map(lineText).join('')).not.toContain('\u001b');
    expect(lines.map(lineText).join('').replace(/\s/g, '')).toContain(
      'Alongstatusthatmustwrapcompletely',
    );
  }
});

test('deployment loaders attach structured documents and preserve history pagination', async () => {
  const detail = vi.fn(async () => deployment);
  const audit = vi.fn(async () => ({ entries: history, total: 95 }));
  const context = {
    client: {
      deployments: {
        detail: { query: detail },
        history: { query: audit },
        resources: {
          query: async () => ({
            status: 'available',
            sampledAt: at,
            cpuPercent: 25,
            memoryUsedBytes: 1024,
            memoryLimitBytes: 4096,
          }),
        },
        resourceHistory: {
          query: async () => ({ from: at, to: at, intervalMs: 30000, points: [] }),
        },
      },
    },
  } as unknown as ClientContext;
  const options = { source: 'origin' as const, query: '' };
  for (const tab of ['Overview', 'Addresses', 'Resources', 'History'] as const) {
    const loaded = await loadDeployment(context, 'project', 'deploy-123', tab, options);
    expect(loaded.document?.length).toBeGreaterThan(0);
    expect(JSON.stringify(loaded)).not.toContain('must-not-appear');
  }
  const loaded = await loadDeployment(
    context,
    'project',
    'deploy-123',
    'History',
    { ...options, query: 'production' },
    { id: 'deploy-123', title: '', subtitle: '', lines: [], data: { offset: 40 } },
  );
  expect(loaded.data).toMatchObject({ offset: 40, hasNext: true });
  expect(audit).toHaveBeenLastCalledWith(
    expect.objectContaining({ offset: 40, search: 'production' }),
  );
});

test('resources loads current usage and history together and retains history when the container stops', async () => {
  const resources = vi.fn(async () => ({
    status: 'unavailable',
    reason: 'container-stopped',
    sampledAt: at,
  }));
  const history = vi.fn(async () => ({
    from: at,
    to: at,
    intervalMs: 30000,
    points: [{ sampledAt: at, cpuPercent: 25, memoryUsedBytes: 1024, memoryLimitBytes: 4096 }],
  }));
  const context = {
    client: {
      deployments: { resources: { query: resources }, resourceHistory: { query: history } },
    },
  } as unknown as ClientContext;
  const loaded = await loadDeployment(context, 'project', 'deploy-123', 'Resources', {
    source: 'origin',
    query: '',
  });
  expect(resources).toHaveBeenCalledWith({ projectId: 'project', deploymentId: 'deploy-123' });
  expect(history).toHaveBeenCalledWith({ projectId: 'project', deploymentId: 'deploy-123' });
  expect(loaded.lines.join('\n')).toContain('container is stopped');
  expect(loaded.lines.join('\n')).toContain('peak 25.0%');
  expect(loaded.lines.join('\n')).toContain('1.0 KiB');
});

test('a failed history request keeps live metrics visible without hiding authorization failures', async () => {
  const resourceHistory = vi.fn(async () => {
    throw new Error('History temporarily unavailable');
  });
  const context = {
    client: {
      deployments: {
        resources: {
          query: async () => ({
            status: 'available',
            sampledAt: at,
            cpuPercent: 25,
            memoryUsedBytes: 1024,
            memoryLimitBytes: 4096,
          }),
        },
        resourceHistory: { query: resourceHistory },
      },
    },
  } as unknown as ClientContext;
  const loaded = await loadDeployment(context, 'project', 'deploy-123', 'Resources', {
    source: 'origin',
    query: '',
  });
  expect(loaded.lines.join('\n')).toContain('25.0%');
  expect(loaded.lines.join('\n')).toContain('Could not load historical usage.');
  resourceHistory.mockRejectedValueOnce(new CliError('Session revoked', 3));
  await expect(
    loadDeployment(context, 'project', 'deploy-123', 'Resources', { source: 'origin', query: '' }),
  ).rejects.toMatchObject({ exitCode: 3 });
});
