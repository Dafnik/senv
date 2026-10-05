import { expect, test, vi } from 'vite-plus/test';
import {
  createHistory,
  entry,
  queryAudit,
  setupDeploymentHistoryTests,
} from './deployment-history.test-support';

setupDeploymentHistoryTests();
test('project audit includes deployments without history actions', async () => {
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
  expect(queryAudit.mock.lastCall?.[0]).not.toHaveProperty('deploymentId');
  await fixture.whenStable();
  expect(
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('thead th'),
      (header) => header.textContent?.trim(),
    ),
  ).toEqual(['Time', 'Event', 'Deployment', 'Actor', 'Details']);
  expect(fixture.nativeElement.textContent).toContain(entry.deploymentId);
  expect(fixture.nativeElement.textContent).not.toContain('Forget history');
});
