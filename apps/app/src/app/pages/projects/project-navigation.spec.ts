import { TestBed } from '@angular/core/testing';
import { expect, test } from 'vite-plus/test';
import {
  listInvitations,
  project,
  queryClient,
  setupProjectTests,
} from './projects.spec-setup';
import { ProjectPage } from './project-page/project-page.page';

setupProjectTests();
test('project opens Deployments by default and loads member controls only after selecting Members', async () => {
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', project.previewSlug],
    project,
  );
  const fixture = TestBed.createComponent(ProjectPage);
  fixture.componentRef.setInput('projectSlug', project.previewSlug);
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('[role="tab"][aria-selected="true"]')
      .textContent,
  ).toContain('Deployments');
  expect(fixture.nativeElement.querySelector('app-project-members')).toBeNull();
  expect(fixture.nativeElement.querySelector('#rename-project')).toBeNull();
  expect(listInvitations).not.toHaveBeenCalled();
  fixture.nativeElement.querySelector('[hlmTabsTrigger="members"]').click();
  fixture.componentRef.setInput('section', 'members');
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('app-project-members table'),
  ).not.toBeNull();
  expect(fixture.nativeElement.querySelector('app-invite-form')).not.toBeNull();
  expect(
    fixture.nativeElement.querySelector('app-project-invitations'),
  ).not.toBeNull();
  expect(fixture.nativeElement.querySelector('#rename-project')).toBeNull();
  fixture.nativeElement.querySelector('[hlmTabsTrigger="settings"]').click();
  fixture.componentRef.setInput('section', 'settings');
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('#rename-project')).not.toBeNull();
  expect(
    fixture.nativeElement.querySelector('[hlmTabsContent="members"]').hidden,
  ).toBe(true);
});

test('viewers can see members and settings but cannot invite or change roles or settings', async () => {
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', project.previewSlug],
    {
      ...project,
      members: [{ ...project.members[0], role: 'viewer' }],
    },
  );
  const fixture = TestBed.createComponent(ProjectPage);
  fixture.componentRef.setInput('projectSlug', project.previewSlug);
  await fixture.whenStable();
  fixture.nativeElement.querySelector('[hlmTabsTrigger="members"]').click();
  fixture.componentRef.setInput('section', 'members');
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('app-project-members table'),
  ).not.toBeNull();
  expect(
    fixture.nativeElement.querySelector(
      'button[aria-label="Change role for Admin"]',
    ),
  ).toBeNull();
  expect(
    fixture.nativeElement.querySelector('app-project-invitations'),
  ).toBeNull();
  expect(listInvitations).not.toHaveBeenCalled();
  fixture.nativeElement.querySelector('[hlmTabsTrigger="settings"]').click();
  fixture.componentRef.setInput('section', 'settings');
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('#rename-project')).toBeNull();
  expect(fixture.nativeElement.textContent).toContain(
    'Project developers and admins can configure runtime values.',
  );
});
