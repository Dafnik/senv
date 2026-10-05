import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { expect, test, vi } from 'vite-plus/test';
import {
  createProjectHarness,
  setupProjectRoutingTests,
} from './project-routing.test-support';
import { DeploymentDetail } from './deployment-detail';
import { deploymentData } from './project-routing.fixture';

import { mockVirtualScrollLayout } from './virtual-scroll.test-support';

mockVirtualScrollLayout();
setupProjectRoutingTests();
test('deployment resources and logs have direct routes, breadcrumbs, and navigation', async () => {
  const harness = await createProjectHarness();
  const settingsSpy = vi.spyOn(deploymentData, 'settings');
  const credentialsSpy = vi.spyOn(deploymentData, 'credentials');
  const listSpy = vi.spyOn(deploymentData, 'list');
  const historySpy = vi.spyOn(deploymentData, 'history');
  const details = await harness.navigateByUrl(
    '/projects/project-preview/deployments/acf379',
    DeploymentDetail,
  );
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(
      harness.routeNativeElement?.querySelector('#deployment-configuration'),
    ).not.toBeNull();
  });
  expect(details.projectSlug()).toBe('project-preview');
  expect(deploymentData.detail).toHaveBeenCalledWith(
    'admin-session',
    'project-id',
    'acf379',
  );
  expect(historySpy).toHaveBeenCalledWith(
    'admin-session',
    expect.objectContaining({
      projectId: 'project-id',
      deploymentId: 'acf379',
      offset: 0,
      limit: 20,
      sortBy: 'createdAt',
      sortDirection: 'desc',
    }),
  );
  expect(settingsSpy).not.toHaveBeenCalled();
  expect(credentialsSpy).not.toHaveBeenCalled();
  expect(listSpy).not.toHaveBeenCalled();
  expect(
    harness.routeNativeElement?.querySelector('#publish-deployment-card'),
  ).toBeNull();
  expect(
    harness.routeNativeElement?.querySelector(
      'nav[aria-label="Deployment sections"]',
    ),
  ).toBeNull();
  expect(
    harness.routeNativeElement?.querySelector(
      'button[aria-label="Copy deployment details link"]',
    ),
  ).toBeNull();
  expect(harness.routeNativeElement?.textContent).toContain('Health checks');
  expect(harness.routeNativeElement?.textContent).toContain('Ada');
  expect(
    harness.routeNativeElement?.querySelector(
      '[aria-label="Breadcrumb"] a[href="/projects/project-preview/deployments"]',
    ),
  ).not.toBeNull();
  expect(
    harness.routeNativeElement?.querySelector(
      'a[href="/projects/project-preview/deployments/acf379/resources"]',
    ),
  ).not.toBeNull();
  expect(
    harness.routeNativeElement?.querySelector(
      'a[href="/projects/project-preview/deployments/acf379/logs"]',
    ),
  ).not.toBeNull();

  const resources = await harness.navigateByUrl(
    '/projects/project-preview/deployments/acf379/resources',
    DeploymentDetail,
  );
  expect(resources.view()).toBe('resources');
  expect(
    harness.routeNativeElement?.querySelector(
      'app-deployment-header #deployment-information',
    ),
  ).not.toBeNull();
  expect(
    harness.routeNativeElement?.querySelector('app-deployment-header')
      ?.className,
  ).not.toContain('sticky');
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(harness.routeNativeElement?.textContent).toContain('43.4%');
  });
  expect(deploymentData.resources).toHaveBeenCalledWith(
    'admin-session',
    'project-id',
    'acf379',
    true,
  );
  expect(
    harness.routeNativeElement?.querySelector(
      '[aria-label="Breadcrumb"] a[href="/projects/project-preview/deployments/acf379"]',
    ),
  ).not.toBeNull();
  expect(
    harness.routeNativeElement?.querySelector('[aria-current="page"]')
      ?.textContent,
  ).toBe('Resources');

  const logs = await harness.navigateByUrl(
    '/projects/project-preview/deployments/acf379/logs?source=proxy',
    DeploymentDetail,
  );
  expect(logs.view()).toBe('logs');
  expect(
    harness.routeNativeElement?.querySelector(
      'app-deployment-header #deployment-information',
    ),
  ).not.toBeNull();
  expect(
    harness.routeNativeElement?.querySelector('app-deployment-header')
      ?.className,
  ).not.toContain('sticky');
  expect(logs.source()).toBe('proxy');
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(
      harness.routeNativeElement?.querySelector(
        'cdk-virtual-scroll-viewport[aria-label="Proxy logs"]',
      )?.textContent,
    ).toContain('latest proxy output');
  });
  expect(
    harness.routeNativeElement?.querySelector(
      '[aria-label="Breadcrumb"] a[href="/projects/project-preview/deployments/acf379"]',
    ),
  ).not.toBeNull();
  expect(
    harness.routeNativeElement?.querySelector('[aria-current="page"]')
      ?.textContent,
  ).toBe('Logs');
  expect(harness.routeNativeElement?.textContent).not.toContain(
    'Load older logs',
  );
  await vi.waitFor(() => {
    harness.detectChanges();
    const text =
      harness.routeNativeElement?.querySelector('cdk-virtual-scroll-viewport')
        ?.textContent ?? '';
    expect(text).toContain('older proxy output');
    expect(text.indexOf('older')).toBeLessThan(text.indexOf('latest'));
  });
  const origin = [
    ...harness.routeNativeElement!.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    ),
  ].find((button) => button.textContent?.trim() === 'Origin')!;
  origin.click();
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe(
      '/projects/project-preview/deployments/acf379/logs?source=origin',
    );
    expect(
      harness.routeNativeElement?.querySelector(
        'cdk-virtual-scroll-viewport[aria-label="Origin logs"]',
      )?.textContent,
    ).toContain('latest origin output');
  });
});
