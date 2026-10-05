import { createElement } from 'react';
import { renderToString } from 'ink';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import { expect, test, vi } from 'vite-plus/test';
import { TuiApp } from './app.tsx';
import { initialState, type TuiController } from './controller.ts';
import { row } from './workspace.ts';
import type { State } from './types.ts';
import {
  addressesDocument,
  detailDocument,
  eventsDocument,
  logsDocument,
  overviewDocument,
  resourceHistoryDocument,
  resourcesDocument,
} from './deployment-detail.ts';

const dimensions = vi.hoisted(() => ({ columns: 100, rows: 24 }));
vi.mock('ink', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ink')>()),
  useWindowSize: () => dimensions,
}));

function renderState(columns: number, rows: number, patch: Partial<State> = {}) {
  Object.assign(dimensions, { columns, rows });
  const state: State = {
    ...initialState(),
    screen: 'Deployments',
    instance: 'work',
    account: 'user@example.com',
    project: 'Website',
    projectId: 'website',
    navigation: ['Projects', 'Account', 'Administration', 'Instances'],
    screens: [
      'Projects',
      'Deployments',
      'History',
      'Members',
      'Invitations',
      'Account',
      'Sessions',
      'Automation tokens',
      'Users',
      'Instance statistics',
      'Instances',
    ],
    status: 'Connected',
    rows: [row('deploy-123', 'deploy-123  static  healthy', 'main  pinned', {})],
    ...patch,
  };
  const controller = {
    snapshot: () => state,
    subscribe: () => () => {},
    visibleRows: () => state.rows,
    setViewport: () => {},
  } as unknown as TuiController;
  const output = stripVTControlCharacters(
    renderToString(createElement(TuiApp, { controller }), { columns }),
  );
  const lines = output.split('\n');
  expect(lines.length).toBeLessThanOrEqual(rows);
  expect(lines.every((line) => stringWidth(line) <= columns)).toBe(true);
  return output;
}

for (const columns of [40, 60, 89, 100, 140]) {
  test(`project tabs and list fit a ${columns}-column terminal`, () => {
    const output = renderState(columns, 24);
    expect(output).toContain('Projects / Website');
    expect(output).toContain('[Deployments]');
    expect(output).toContain('deploy-123');
    expect(output).toContain('a actions');
    if (columns >= 90) expect(output).toContain('Workspace');
  });
}

test('narrow terminals keep the active tab visible when earlier tabs overflow', () => {
  const output = renderState(40, 10, { screen: 'Automation tokens', navIndex: 1, rows: [] });
  expect(output).toContain('[Automation tokens]');
  expect(output).toContain('...');
});

test('deployment detail tabs replace project tabs and retain the project breadcrumb', () => {
  const output = renderState(100, 24, {
    detail: row('deploy-123', 'deploy-123', '', {}, ['Origin is healthy']),
    tab: 'Logs',
  });
  expect(output).toContain('Projects / Website / Deployments');
  expect(output).toContain('[Logs]');
  expect(output).toContain('Origin is healthy');
  expect(output).not.toContain(' Invitations ');
});

test('narrow sidebar focus names the selected destination', () => {
  const output = renderState(40, 24, { focus: 'navigation', navIndex: 2 });
  expect(output).toContain('Navigate: [ Administration ]');
});

const at = new Date('2026-10-05T10:12:34Z');
const overview = overviewDocument({
  id: 'deploy-123',
  kind: 'static',
  status: 'healthy',
  desiredState: 'running',
  pinned: true,
  submittedAt: at,
  readyAt: at,
  source: { repository: 'https://github.com/example/website', branch: 'main', commit: 'abc123' },
  artifactId: 'artifact',
  imageDigest: null,
  failureReason: null,
  branchAlias: 'main',
  tags: ['production'],
  retentionDeadlineAt: null,
} as Parameters<typeof overviewDocument>[0]);
const events = eventsDocument(
  [
    {
      id: 'event',
      projectId: 'website',
      deploymentId: 'deploy-123',
      event: 'tag-assigned',
      createdAt: at,
      actorType: 'user',
      actor: { id: 'user', name: 'Dafni' },
      details: { name: 'production' },
    } as Parameters<typeof eventsDocument>[0][number],
  ],
  'No events',
);
const examples = [
  { tab: 'Overview' as const, document: overview, expected: '[ HEALTHY ]  Static site' },
  {
    tab: 'Addresses' as const,
    document: addressesDocument({
      fixed: 'https://deploy-123.website.example.com',
      branch: 'https://main.website.example.com',
      tags: [{ name: 'production', url: 'https://production.website.example.com' }],
    }),
    expected: 'FIXED ADDRESS',
  },
  {
    tab: 'Resources' as const,
    document: resourcesDocument({
      status: 'available',
      sampledAt: at,
      cpuPercent: 25.5,
      memoryUsedBytes: 512 * 1024 ** 2,
      memoryLimitBytes: 1024 ** 3,
    }),
    expected: '512.0 MiB',
  },
  { tab: 'History' as const, document: events, expected: 'Tag assigned' },
  {
    tab: 'Logs' as const,
    document: logsDocument([
      { createdAt: at, sequence: 1, content: '{"level":30,"msg":"Server is ready","port":8080}' },
    ]),
    expected: 'Server is ready',
  },
];
for (const columns of [40, 100, 140]) {
  for (const example of examples) {
    test(`${example.tab} has a readable detail layout at ${columns} columns`, () => {
      const detail = detailDocument(
        row('deploy-123', 'deploy-123', 'Deployment details', {}, []),
        example.document,
      );
      const output = renderState(columns, 24, { detail, tab: example.tab });
      expect(output).toContain(example.expected);
      expect(output).not.toContain('cpuPercent');
      expect(output).not.toContain('actorType');
    });
  }
}

test('scrolling to the end uses the last complete viewport after width-dependent wrapping', () => {
  const detail = detailDocument(
    row('deploy-123', 'deploy-123', 'Deployment details', {}, []),
    overview,
  );
  const output = renderState(100, 24, { detail, scroll: Number.MAX_SAFE_INTEGER });
  expect(output).toContain('No expiry scheduled');
  expect(output).toContain('Addresses has the full URLs');
});

test('metric history charts and samples render together', () => {
  const document = resourceHistoryDocument({
    from: at,
    to: at,
    intervalMs: 30_000,
    points: [
      {
        sampledAt: at,
        cpuPercent: 10,
        memoryUsedBytes: 512 * 1024 ** 2,
        memoryLimitBytes: 1024 ** 3,
      },
      {
        sampledAt: at,
        cpuPercent: 25,
        memoryUsedBytes: 640 * 1024 ** 2,
        memoryLimitBytes: 1024 ** 3,
      },
    ],
  });
  const detail = detailDocument(row('deploy-123', 'Resource history', '', {}, []), document);
  const output = renderState(140, 30, { detail, tab: 'Resources' });
  expect(output).toContain('peak 25.0%');
  expect(output).toContain('640.0 MiB');
  expect(output).toContain('Sampled (UTC)');
});
