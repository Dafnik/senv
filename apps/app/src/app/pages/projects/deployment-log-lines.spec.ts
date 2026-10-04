import type { DeploymentLogPage } from '@senv/api/shared/deployments';
import { expect, test } from 'vite-plus/test';
import { deploymentLogLines } from './deployment-log-lines';

test('orders pages chronologically, preserves multiline content and blank lines, and removes overlap', () => {
  const record = (id: string, content: string) => ({
    id,
    sequence: 1,
    deploymentId: 'deployment',
    source: 'origin' as const,
    createdAt: new Date(0),
    content,
  });
  const pages: DeploymentLogPage[] = [
    {
      logs: [record('latest', 'latest\r\ncontinuation\r\n')],
      nextCursor: { sequence: 1 },
    },
    {
      logs: [
        record('older', 'older\n\nlast line'),
        record('latest', 'latest\r\ncontinuation\r\n'),
      ],
      nextCursor: null,
    },
  ];
  const rows = deploymentLogLines(pages);
  expect(rows.map((row) => row.id)).toEqual([
    'older:0',
    'older:1',
    'older:2',
    'latest:0',
    'latest:1',
  ]);
  expect(rows[0].text).toContain('older');
  expect(rows[1].text).toBe('');
  expect(rows[2].text).toBe('last line');
  expect(rows[4].text).toBe('continuation');
});
