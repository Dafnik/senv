import { expect, test, vi } from 'vite-plus/test';
import {
  createHistory,
  entry,
  queryAudit,
  selectOption,
  setupDeploymentHistoryTests,
} from './deployment-history.test-support';

setupDeploymentHistoryTests();
test('audit table sends scoped pages and sorting to the server', async () => {
  queryAudit.mockResolvedValue({
    entries: [entry],
    total: 121,
    events: ['deleted', 'updated'],
    actors: [
      { id: 'actor-id', name: 'Ada Admin' },
      { id: 'system', name: 'System' },
    ],
  });
  const fixture = createHistory('deployment-123456');
  await vi.waitFor(() =>
    expect(fixture.componentInstance.audit.data()?.total).toBe(121),
  );

  const table = fixture.componentInstance.table;
  expect(table.getPageCount()).toBe(7);
  expect(queryAudit.mock.lastCall?.[0]).toMatchObject({
    projectId: 'project-id',
    deploymentId: 'deployment-123456',
    offset: 0,
    limit: 20,
    sortBy: 'createdAt',
    sortDirection: 'desc',
  });
  table.setPageIndex(3);
  await vi.waitFor(() => expect(queryAudit.mock.lastCall?.[0].offset).toBe(60));
  const eventSort = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'thead button',
    ),
  ).find((button) => button.textContent.includes('Event')) as HTMLButtonElement;
  eventSort.click();
  await vi.waitFor(() =>
    expect(queryAudit.mock.lastCall?.[0]).toMatchObject({
      offset: 0,
      sortBy: 'event',
      sortDirection: 'asc',
    }),
  );
  const actorSort = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'thead button',
    ),
  ).find((button) => button.textContent.includes('Actor')) as HTMLButtonElement;
  actorSort.click();
  await vi.waitFor(() =>
    expect(queryAudit.mock.lastCall?.[0]).toMatchObject({
      sortBy: 'actor',
      sortDirection: 'asc',
    }),
  );
  expect(fixture.nativeElement.textContent).toContain('Ada Admin');
  expect(fixture.nativeElement.textContent).toContain('retention');
  expect(fixture.nativeElement.textContent).toContain('deployment-123456');
});

test('search and event/actor filters reset the page and remain available for empty results', async () => {
  queryAudit.mockResolvedValue({
    entries: [entry],
    total: 41,
    events: ['deleted'],
    actors: [{ id: 'actor-id', name: 'Ada Admin' }],
  });
  const fixture = createHistory();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.audit.data()?.total).toBe(41),
  );
  expect(
    fixture.nativeElement.querySelector(
      `#${fixture.componentInstance.eventSelectId()}`,
    ).textContent,
  ).toContain('All events');
  expect(
    fixture.nativeElement.querySelector(
      `#${fixture.componentInstance.actorSelectId()}`,
    ).textContent,
  ).toContain('All actors');
  fixture.componentInstance.table.setPageIndex(2);
  await vi.waitFor(() => expect(queryAudit.mock.lastCall?.[0].offset).toBe(40));

  queryAudit.mockImplementation(
    async (input: { event?: string; actor?: string }) =>
      input.event || input.actor
        ? {
            entries: [],
            total: 0,
            events: ['deleted'],
            actors: [{ id: 'actor-id', name: 'Ada Admin' }],
          }
        : {
            entries: [entry],
            total: 41,
            events: ['deleted'],
            actors: [{ id: 'actor-id', name: 'Ada Admin' }],
          },
  );
  const search: HTMLInputElement = fixture.nativeElement.querySelector(
    'input[aria-label="Search deployment history"]',
  );
  search.value = 'retention';
  search.dispatchEvent(new Event('input'));
  await vi.waitFor(() =>
    expect(queryAudit.mock.lastCall?.[0]).toMatchObject({
      offset: 0,
      search: 'retention',
    }),
  );
  await selectOption(fixture, 'event', 'deleted');
  await vi.waitFor(() =>
    expect(queryAudit.mock.lastCall?.[0].event).toBe('deleted'),
  );
  await selectOption(fixture, 'actor', 'Ada Admin');
  await vi.waitFor(() =>
    expect(queryAudit.mock.lastCall?.[0]).toMatchObject({
      offset: 0,
      search: 'retention',
      event: 'deleted',
      actor: 'actor-id',
    }),
  );
  await vi.waitFor(() =>
    expect(fixture.componentInstance.audit.data()?.total).toBe(0),
  );
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('No matching history');
  expect(
    fixture.nativeElement.querySelector(
      'input[aria-label="Search deployment history"]',
    ),
  ).not.toBeNull();
  expect(
    fixture.nativeElement.querySelector(
      `#${fixture.componentInstance.eventSelectId()}`,
    ),
  ).not.toBeNull();
});
