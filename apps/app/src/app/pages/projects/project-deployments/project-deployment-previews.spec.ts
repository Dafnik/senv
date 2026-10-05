import { expect, test } from 'vite-plus/test';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vite-plus/test';
import { DeploymentPreviewStatus } from '../deployment-preview-status';
import {
  createFixture,
  setupProjectDeploymentTests,
} from './project-deployments.spec-setup';
import { deployments } from './project-deployments.spec-data';
import { mock } from './project-deployments.spec-mocks';
setupProjectDeploymentTests();

test('public preview reports HTTP errors separately from container health and can be rechecked', async () => {
  const fixture = TestBed.createComponent(DeploymentPreviewStatus);
  fixture.componentRef.setInput('deployment', deployments[0]!);
  await fixture.whenStable();
  expect(mock.previewStatus).toHaveBeenCalledWith(
    'session-a',
    'project-a',
    'deployment-a',
    true,
  );
  expect(fixture.nativeElement.textContent).toContain('HTTP 404');
  expect(fixture.nativeElement.textContent).toContain(
    'Container health does not confirm public access',
  );
  expect(fixture.nativeElement.textContent).toContain('12 ms');
  const query = vi.spyOn(fixture.componentInstance.status, 'refetch');
  fixture.nativeElement
    .querySelector('button[aria-label="Check preview again"]')
    .click();
  await fixture.whenStable();
  expect(query).toHaveBeenCalledOnce();
});

test.each([
  { statusCode: 200, error: null, expected: 'HTTP 200' },
  {
    statusCode: null,
    error: 'The preview server refused the connection.',
    expected: 'Unreachable',
  },
])(
  'public preview displays $expected',
  async ({ statusCode, error, expected }) => {
    mock.previewStatus.mockReturnValueOnce({
      queryKey: ['preview-status'],
      enabled: true,
      queryFn: async () => ({
        url: deployments[0].previewUrl,
        statusCode,
        checkedAt: new Date(),
        responseTimeMs: 12,
        error,
      }),
      refetchInterval: false,
    });
    const fixture = TestBed.createComponent(DeploymentPreviewStatus);
    fixture.componentRef.setInput('deployment', deployments[0]!);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(expected);
    if (error) expect(fixture.nativeElement.textContent).toContain(error);
  },
);

test('stopped deployments do not request a public preview check', async () => {
  const fixture = TestBed.createComponent(DeploymentPreviewStatus);
  fixture.componentRef.setInput('deployment', {
    ...deployments[0],
    desiredState: 'stopped',
    status: 'stopped',
  });
  await fixture.whenStable();
  expect(mock.previewStatus).toHaveBeenCalledWith(
    'session-a',
    'project-a',
    'deployment-a',
    false,
  );
  expect(fixture.nativeElement.textContent).toContain('Unavailable');
  expect(fixture.nativeElement.querySelector('button')).toBeNull();
});

test('preview buttons form one group and copy the exact preview URL', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const writeText = vi.fn(async () => undefined);
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  try {
    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector(
        'button[aria-label="Copy deployment details link"]',
      ),
    ).toBeNull();
    const group = element.querySelector(
      '[role="group"][aria-label="Preview actions"]',
    )!;
    expect(group.querySelector('a')?.getAttribute('href')).toBe(
      deployments[0]!.previewUrl,
    );
    expect(
      group.querySelector('button[aria-label="Copy preview link"]'),
    ).not.toBeNull();
    element
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Copy preview link"]',
      )!
      .click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenLastCalledWith(deployments[0]!.previewUrl);
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
