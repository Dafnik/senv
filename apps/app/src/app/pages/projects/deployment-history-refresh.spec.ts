import { expect, test, vi } from 'vite-plus/test';
import {
  createHistory,
  entry,
  queryHistory,
  queryClient,
  session,
  setupDeploymentHistoryTests,
} from './deployment-history.test-support';

setupDeploymentHistoryTests();
test('scope changes clear search, filters, and pages and include the new session in cache keys', async () => {
  queryHistory.mockResolvedValue({
    entries: [entry],
    total: 61,
    events: ['deleted'],
    actors: [{ id: 'actor-id', name: 'Ada Admin' }],
  });
  const fixture = createHistory();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.history.data()?.total).toBe(61),
  );
  fixture.componentInstance.search.set('first scope');
  fixture.componentInstance.setEventFilter('deleted');
  fixture.componentInstance.setActorFilter('actor-id');
  fixture.componentInstance.table.setPageIndex(2);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.pagination().pageIndex).toBe(2),
  );

  fixture.componentRef.setInput('projectId', 'another-project');
  fixture.componentRef.setInput('deploymentId', 'another-deployment');
  expect(fixture.componentInstance.search()).toBe('');
  expect(fixture.componentInstance.eventFilter()).toBe('');
  expect(fixture.componentInstance.actorFilter()).toBe('');
  expect(fixture.componentInstance.pagination().pageIndex).toBe(0);
  await vi.waitFor(() =>
    expect(queryHistory.mock.lastCall?.[0]).toMatchObject({
      projectId: 'another-project',
      deploymentId: 'another-deployment',
      offset: 0,
      search: '',
    }),
  );

  fixture.componentInstance.search.set('prior session search');
  fixture.componentInstance.setActorFilter('actor-id');
  fixture.componentInstance.table.setPageIndex(2);
  session.set({
    data: { session: { id: 'next-session' }, user: { id: 'user-id' } },
  });
  expect(fixture.componentInstance.search()).toBe('');
  expect(fixture.componentInstance.actorFilter()).toBe('');
  expect(fixture.componentInstance.pagination().pageIndex).toBe(0);
  await vi.waitFor(() =>
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .some((query) => query.queryKey[1] === 'next-session'),
    ).toBe(true),
  );
});
