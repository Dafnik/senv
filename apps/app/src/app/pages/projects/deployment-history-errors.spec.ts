import { expect, test, vi } from 'vite-plus/test';
import {
  createHistory,
  queryHistory,
  setupDeploymentHistoryTests,
} from './deployment-history.test-support';

setupDeploymentHistoryTests();
test('audit failures show an alert and a retry action while retaining filters', async () => {
  queryHistory.mockRejectedValue(new Error('Audit service unavailable'));
  const fixture = createHistory();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.history.isError()).toBe(true),
  );
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain(
    'Audit service unavailable',
  );
  expect(
    fixture.nativeElement.querySelector(
      `#${fixture.componentInstance.actorSelectId()}`,
    ),
  ).not.toBeNull();
  expect(fixture.nativeElement.textContent).toContain('Try again');
});
