import { TestBed } from '@angular/core/testing';
import { expect, test, vi } from 'vite-plus/test';
import {
  createProject,
  getFullOrganization,
  list,
  project,
  queryClient,
  update,
  setupProjectTests,
} from './projects.spec-setup';
import { ProjectPage } from './project-page/project-page.page';
import { ProjectsPage } from './projects-page/projects-page.page';

setupProjectTests();
test('returning to Projects immediately after renaming shows the new name', async () => {
  queryClient.setQueryData(['projects', 'session-id'], {
    pages: [{ projects: [project], nextCursor: null }],
    pageParams: [undefined],
  });
  queryClient.setQueryData(
    ['project-by-slug', 'session-id', project.previewSlug],
    project,
  );
  const renamed = { ...project, name: 'New name' };
  update.mockResolvedValue(renamed);
  getFullOrganization.mockResolvedValue(renamed);
  list.mockResolvedValue({ projects: [renamed], nextCursor: null });
  const detail = TestBed.createComponent(ProjectPage);
  detail.componentRef.setInput('projectSlug', project.previewSlug);
  await detail.whenStable();
  detail.nativeElement.querySelector('[hlmTabsTrigger="settings"]').click();
  detail.componentRef.setInput('section', 'settings');
  await detail.whenStable();
  const input: HTMLInputElement =
    detail.nativeElement.querySelector('#rename-project');
  input.value = 'New name';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await detail.whenStable();
  detail.componentInstance.rename(new Event('submit'));
  await vi.waitFor(() => expect(detail.componentInstance.busy()).toBe(false));
  expect(update).toHaveBeenCalledWith({
    projectId: project.id,
    name: 'New name',
  });
  detail.destroy();
  const projects = TestBed.createComponent(ProjectsPage);
  await vi.waitFor(async () => {
    await projects.whenStable();
    expect(projects.nativeElement.textContent).toContain('New name');
    expect(projects.nativeElement.textContent).not.toContain('Old name');
  });
  expect(list).toHaveBeenCalledTimes(1);
});

test('project creation suggests an editable DNS-safe slug and submits that value', async () => {
  list.mockResolvedValue({ projects: [], nextCursor: null });
  createProject.mockResolvedValue({
    ...project,
    id: 'new-project',
    previewSlug: 'custom-preview',
  });
  const fixture = TestBed.createComponent(ProjectsPage);
  await fixture.whenStable();

  const name = fixture.nativeElement.querySelector(
    '#project-name',
  ) as HTMLInputElement;
  const slug = fixture.nativeElement.querySelector(
    '#project-preview-slug',
  ) as HTMLInputElement;
  name.value = 'My New Project';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await fixture.whenStable();
  await vi.waitFor(() => expect(slug.value).toBe('my-new-project'));

  slug.value = 'team-preview';
  slug.dispatchEvent(new Event('input', { bubbles: true }));
  name.value = 'Renamed Project';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await fixture.whenStable();
  expect(slug.value).toBe('team-preview');

  fixture.componentInstance.create(new Event('submit'));
  await fixture.whenStable();
  expect(createProject).toHaveBeenCalledWith({
    name: 'Renamed Project',
    previewSlug: 'team-preview',
  });
});
