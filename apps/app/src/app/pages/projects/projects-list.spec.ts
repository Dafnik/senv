import { TestBed } from '@angular/core/testing';
import { expect, test, vi } from 'vite-plus/test';
import { list, project, setupProjectTests } from './projects.spec-setup';
import { ProjectsPage } from './projects-page/projects-page.page';

setupProjectTests();
test('virtual project list loads further pages near the rendered end and stops at the final cursor', async () => {
  const cursor = { createdAt: 1000, id: 'project-39' };
  const first = Array.from({ length: 40 }, (_, i) => ({
    id: `project-${i}`,
    name: `Project ${i}`,
    createdAt: new Date(1000),
  }));
  const second = Array.from({ length: 40 }, (_, i) => ({
    id: `project-${i + 40}`,
    name: `Project ${i + 40}`,
    createdAt: new Date(1000),
  }));
  list
    .mockResolvedValueOnce({ projects: first, nextCursor: cursor })
    .mockResolvedValueOnce({ projects: second, nextCursor: null });
  const projects = TestBed.createComponent(ProjectsPage);
  await vi.waitFor(() =>
    expect(projects.componentInstance.projectItems()).toHaveLength(40),
  );
  expect(list).toHaveBeenCalledTimes(1);
  projects.componentInstance.loadMore(12);
  expect(list).toHaveBeenCalledTimes(1);
  projects.componentInstance.loadMore(35);
  projects.componentInstance.loadMore(39);
  await vi.waitFor(() =>
    expect(projects.componentInstance.projectItems()).toHaveLength(80),
  );
  expect(list).toHaveBeenCalledTimes(2);
  expect(list.mock.calls[1][0]).toEqual({ cursor, limit: 40 });
  projects.componentInstance.loadMore(80);
  expect(list).toHaveBeenCalledTimes(2);
});

test('a failed next page keeps loaded projects and can be retried', async () => {
  const cursor = { createdAt: 1000, id: 'project-39' };
  const first = Array.from({ length: 40 }, (_, i) => ({
    id: `project-${i}`,
    name: `Project ${i}`,
    createdAt: new Date(1000),
  }));
  list
    .mockResolvedValueOnce({ projects: first, nextCursor: cursor })
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({ projects: [project], nextCursor: null });
  const projects = TestBed.createComponent(ProjectsPage);
  await vi.waitFor(() =>
    expect(projects.componentInstance.projectItems()).toHaveLength(40),
  );
  projects.componentInstance.loadMore(40);
  await vi.waitFor(() =>
    expect(projects.componentInstance.projects.isFetchNextPageError()).toBe(
      true,
    ),
  );
  await projects.whenStable();
  expect(projects.componentInstance.projectItems()).toHaveLength(40);
  expect(
    projects.nativeElement.querySelector('cdk-virtual-scroll-viewport'),
  ).not.toBeNull();
  expect(projects.nativeElement.textContent).toContain(
    'Try loading more again',
  );
  await projects.componentInstance.projects.fetchNextPage();
  expect(projects.componentInstance.projectItems()).toHaveLength(41);
});
