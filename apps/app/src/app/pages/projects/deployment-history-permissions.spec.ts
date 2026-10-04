import { expect, test, vi } from 'vite-plus/test';
import {
  createHistory,
  entry,
  queryAudit,
  setupDeploymentHistoryTests,
} from './deployment-history.test-support';

setupDeploymentHistoryTests();
test('project audit is unscoped by deployment and admins retain history removal', async () => {
  queryAudit.mockResolvedValue({
    entries: [entry],
    total: 1,
    events: ['deleted'],
    actors: [],
  });
  const fixture = createHistory(undefined, true);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.audit.data()?.entries).toHaveLength(1),
  );
  expect(queryAudit.mock.lastCall?.[0]).not.toHaveProperty('deploymentId');
  await fixture.whenStable();
  const forget = Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'button',
    ),
  ).find((button) =>
    button.textContent.includes('Forget history'),
  ) as HTMLButtonElement;
  expect(forget?.textContent).toContain('Forget history');
  forget.click();
  expect(
    fixture.componentInstance.actions().forgetHistory,
  ).toHaveBeenCalledWith(entry.deploymentId);
});
