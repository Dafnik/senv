import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { expect, test, vi } from 'vite-plus/test';
import {
  getFullOrganization,
  project,
  queryClient,
  removeMember,
  session,
  update,
  setupProjectTests,
} from './projects.spec-setup';
import { ProjectPage } from './project-page/project-page.page';

setupProjectTests();
test('background membership refresh preserves a dirty name draft and remote rename warns before saving', async () => {
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', project.previewSlug],
    project,
  );
  const fixture = TestBed.createComponent(ProjectPage);
  fixture.componentRef.setInput('projectSlug', project.previewSlug);
  fixture.componentRef.setInput('section', 'settings');
  await fixture.whenStable();
  const name: HTMLInputElement =
    fixture.nativeElement.querySelector('#rename-project');
  name.value = 'My unsaved name';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await fixture.whenStable();
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', project.previewSlug],
    {
      ...project,
      members: [],
    },
  );
  await fixture.whenStable();
  expect(name.value).toBe('My unsaved name');
  expect(fixture.componentInstance.remoteNameChanged()).toBe(false);
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', project.previewSlug],
    {
      ...project,
      name: 'Remote name',
      members: [],
    },
  );
  await fixture.whenStable();
  expect(fixture.componentInstance.nameForm.name().value()).toBe(
    'My unsaved name',
  );
  expect(fixture.componentInstance.remoteNameChanged()).toBe(true);
  expect(update).not.toHaveBeenCalled();
  fixture.componentInstance.loadCurrentName();
  await fixture.whenStable();
  expect(fixture.componentInstance.nameForm.name().value()).toBe('Remote name');
  expect(fixture.componentInstance.remoteNameChanged()).toBe(false);
});

test('an instance admin without membership sees recovery and project management controls', async () => {
  session.update((current) => ({
    ...current,
    data: { ...current.data, user: { ...current.data.user, role: 'admin' } },
  }));
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', project.previewSlug],
    {
      ...project,
      members: [],
    },
  );
  const fixture = TestBed.createComponent(ProjectPage);
  fixture.componentRef.setInput('projectSlug', project.previewSlug);
  fixture.componentRef.setInput('section', 'members');
  await fixture.whenStable();
  expect(fixture.nativeElement.querySelector('header [hlmBadge]')).toBeNull();
  expect(
    fixture.nativeElement.querySelector('#project-admin-email'),
  ).toBeNull();
  expect(
    fixture.nativeElement.querySelector('app-project-invitations'),
  ).not.toBeNull();
  expect(fixture.componentInstance.isAdmin()).toBe(true);
});

test('a late rename response updates its own cache without replacing a different project draft', async () => {
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', project.previewSlug],
    project,
  );
  const second = {
    ...project,
    id: 'second-project',
    previewSlug: 'second-project',
    name: 'Second project',
  };
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', second.previewSlug],
    second,
  );
  let resolve!: (value: unknown) => void;
  update.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const fixture = TestBed.createComponent(ProjectPage);
  fixture.componentRef.setInput('projectSlug', project.previewSlug);
  fixture.componentRef.setInput('section', 'settings');
  await fixture.whenStable();
  const name: HTMLInputElement =
    fixture.nativeElement.querySelector('#rename-project');
  name.value = 'Saved first name';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await fixture.whenStable();
  fixture.componentInstance.rename(new Event('submit'));
  await vi.waitFor(() => expect(update).toHaveBeenCalled());
  fixture.componentRef.setInput('projectSlug', second.previewSlug);
  await fixture.whenStable();
  resolve({ ...project, name: 'Saved first name' });
  await vi.waitFor(() => expect(fixture.componentInstance.busy()).toBe(false));
  expect(fixture.componentInstance.nameForm.name().value()).toBe(
    'Second project',
  );
  expect(
    queryClient.getQueryState([
      'project-by-slug',
      'session-id',
      project.previewSlug,
    ])?.isInvalidated,
  ).toBe(true);
  expect(
    queryClient.getQueryState([
      'project-by-slug',
      'session-id',
      second.previewSlug,
    ])?.isInvalidated,
  ).toBe(false);
});

test('removing yourself updates project caches and returns to the projects list', async () => {
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', project.previewSlug],
    project,
  );
  queryClient.setQueryData(['projects', 'session-id'], {
    pages: [{ projects: [project], nextCursor: null }],
    pageParams: [undefined],
  });
  removeMember.mockResolvedValue({ success: true });
  getFullOrganization.mockRejectedValue(new Error('Forbidden'));
  const fixture = TestBed.createComponent(ProjectPage);
  fixture.componentRef.setInput('projectSlug', project.previewSlug);
  await fixture.whenStable();
  await fixture.componentInstance.removeMember('member-id');
  expect(removeMember).toHaveBeenCalledWith({
    projectId: project.id,
    memberId: 'member-id',
  });
  expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/projects']);
  expect(
    queryClient.getQueryState(['projects', 'session-id'])?.isInvalidated,
  ).toBe(true);
});
