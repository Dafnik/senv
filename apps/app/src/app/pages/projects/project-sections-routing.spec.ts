import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { expect, test, vi } from 'vite-plus/test';
import {
  createProjectHarness,
  setupProjectRoutingTests,
} from './project-routing.test-support';
import { ProjectPage } from './project-page/project-page.page';

setupProjectRoutingTests();
test('project section URLs support direct links and default to Deployments', async () => {
  const harness = await createProjectHarness();
  const members = await harness.navigateByUrl(
    '/projects/project-preview/members',
    ProjectPage,
  );
  await vi.waitFor(() => {
    const header =
      harness.routeNativeElement?.querySelector('hlm-tabs > header');
    expect(header?.querySelector('hlm-avatar')).not.toBeNull();
    expect(header?.querySelector('hlm-tabs-list')).not.toBeNull();
    expect(header?.querySelector('h1')?.classList.contains('sr-only')).toBe(
      true,
    );
  });
  expect(members.projectSlug()).toBe('project-preview');
  expect(members.section()).toBe('members');
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(
      harness.routeNativeElement?.querySelector('app-project-members'),
    ).not.toBeNull();
  });

  const settings = await harness.navigateByUrl(
    '/projects/project-preview/settings',
    ProjectPage,
  );
  expect(settings).toBe(members);
  expect(settings.section()).toBe('settings');
  harness.detectChanges();
  expect(
    harness.routeNativeElement?.querySelector('#rename-project'),
  ).not.toBeNull();

  await harness.navigateByUrl('/projects/project-preview', ProjectPage);
  expect(TestBed.inject(Router).url).toBe(
    '/projects/project-preview/deployments',
  );
  await harness.navigateByUrl('/projects/project-preview/members', ProjectPage);
  expect(TestBed.inject(Router).url).toBe('/projects/project-preview/members');
});
