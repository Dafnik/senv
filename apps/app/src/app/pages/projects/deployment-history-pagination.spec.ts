test('viewers cannot forget retained history', async () => {
  queryAudit.mockResolvedValue({
    entries: [entry],
    total: 1,
    events: ['deleted'],
    actors: [],
  });
  const fixture = createHistory();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.audit.data()?.entries).toHaveLength(1),
  );
  await fixture.whenStable();
  expect(
    Array.from(
      (
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>('button'),
    ).some((button) => button.textContent.includes('Forget history')),
  ).toBe(false);
});

import { expect, test, vi } from 'vite-plus/test';
import {
  createHistory,
  entry,
  queryAudit,
  setupDeploymentHistoryTests,
} from './deployment-history.test-support';

setupDeploymentHistoryTests();
test('a smaller polled result moves the table back to its last available page', async () => {
  let firstPageLoads = 0;
  queryAudit.mockImplementation(async (input: { offset: number }) =>
    input.offset
      ? { entries: [], total: 20, events: ['deleted'], actors: [] }
      : {
          entries: [entry],
          total: firstPageLoads++ === 0 ? 61 : 20,
          events: ['deleted'],
          actors: [],
        },
  );
  const fixture = createHistory();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.audit.data()?.total).toBe(61),
  );
  fixture.componentInstance.table.setPageIndex(2);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.pagination().pageIndex).toBe(0),
  );
  expect(queryAudit.mock.calls.some(([input]) => input.offset === 40)).toBe(
    true,
  );
  expect(queryAudit.mock.lastCall?.[0].offset).toBe(0);
});
