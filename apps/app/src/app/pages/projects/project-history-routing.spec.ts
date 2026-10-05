import { expect, test, vi } from 'vite-plus/test';
import { ProjectPage } from './project-page/project-page.page';
import { deploymentData } from './project-routing.fixture';
import {
  createProjectHarness,
  setupProjectRoutingTests,
} from './project-routing.test-support';

setupProjectRoutingTests();
test('deployment history has a direct project tab and is absent from the deployments list', async () => {
  const harness = await createProjectHarness();
  const audit = vi.spyOn(deploymentData, 'audit');
  await harness.navigateByUrl(
    '/projects/project-preview/deployments',
    ProjectPage,
  );
  await vi.waitFor(() =>
    expect(
      harness.routeNativeElement?.querySelector('#deployment-list-title'),
    ).not.toBeNull(),
  );
  expect(
    harness.routeNativeElement?.querySelector('#deployment-audit'),
  ).toBeNull();
  expect(audit).not.toHaveBeenCalled();
  const history = [
    ...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    ),
  ].find((tab) => tab.textContent?.trim() === 'History')!;
  history.click();
  await vi.waitFor(() =>
    expect(
      harness.routeNativeElement?.querySelector(
        'table[aria-label="Deployment history"]',
      ),
    ).not.toBeNull(),
  );
  expect(audit).toHaveBeenCalledWith(
    'admin-session',
    expect.objectContaining({ projectId: 'project-id', offset: 0, limit: 20 }),
  );
  const direct = await harness.navigateByUrl(
    '/projects/project-preview/history',
    ProjectPage,
  );
  expect(direct.section()).toBe('history');
  expect(
    harness.routeNativeElement?.querySelector(
      '[role="tab"][aria-selected="true"]',
    )?.textContent,
  ).toContain('History');
});
