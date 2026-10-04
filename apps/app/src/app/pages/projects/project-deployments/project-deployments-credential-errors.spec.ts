import { expect, test, vi } from 'vite-plus/test';
import {
  createFixture,
  setupProjectDeploymentTests,
} from './project-deployments.spec-setup';
import { mock } from './project-deployments.spec-mocks';

setupProjectDeploymentTests();

test('shows credential lookup failures and retries the query', async () => {
  let attempt = 0;
  mock.credentials.mockImplementationOnce(() => ({
    queryKey: ['credentials'],
    enabled: true,
    queryFn: async () => {
      if (attempt++ === 0) throw new Error('Registry service offline');
      return [];
    },
  }));
  const fixture = createFixture(true);
  await fixture.whenStable();
  fixture.componentInstance.model.update((draft) => ({
    ...draft,
    kind: 'container',
  }));
  fixture.componentInstance.publishOpen.set(true);
  await fixture.whenStable();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.credentials.isError()).toBe(true),
  );
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain(
    'Could not load registry credentials.',
  );
  const retry = Array.from(
    fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>,
  ).find((button) => button.textContent?.trim() === 'Try again');
  expect(retry).toBeTruthy();
  retry!.click();
  await vi.waitFor(() => expect(attempt).toBe(2));
  await vi.waitFor(() =>
    expect(fixture.componentInstance.credentials.isSuccess()).toBe(true),
  );
});
