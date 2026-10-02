import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { TrpcService } from '../../trpc/trpc.service';
import { InvitationPage } from './invitation-page/invitation-page.page';
import { ProjectPage } from './project-page/project-page.page';
import { ProjectsPage } from './projects-page/projects-page.page';

const project = {
  id: 'project-id',
  name: 'Old name',
  slug: 'project-id',
  members: [
    {
      id: 'member-id',
      userId: 'user-id',
      role: 'admin',
      user: { id: 'user-id', name: 'Admin', email: 'admin@example.com' },
    },
  ],
  invitations: [],
};
const session = signal({
  data: {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'admin@example.com', emailVerified: true },
  },
});
const list = vi.fn();
const listInvitations = vi.fn();
const update = vi.fn();
const getFullOrganization = vi.fn();
const getInvitation = vi.fn();
const acceptInvitation = vi.fn();
const sendVerificationEmail = vi.fn();
let queryClient: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  session.set({
    data: {
      session: { id: 'session-id' },
      user: { id: 'user-id', email: 'admin@example.com', emailVerified: true },
    },
  });
  listInvitations.mockResolvedValue({ invitations: [], total: 0 });
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30000, retry: false } },
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: TrpcService,
        useValue: {
          client: {
            projects: {
              list: { query: list },
              invitations: { query: listInvitations },
            },
          },
        },
      },
      provideTanStackQuery(() => queryClient),
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: () => session,
          sendVerificationEmail,
          organization: {
            list,
            update,
            getFullOrganization,
            getInvitation,
            acceptInvitation,
          },
        },
      },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
});
afterEach(() => queryClient.clear());

test('returning to Projects immediately after renaming shows the new name', async () => {
  queryClient.setQueryData(['projects', 'session-id'], {
    pages: [{ projects: [project], nextCursor: null }],
    pageParams: [undefined],
  });
  queryClient.setQueryData(['project', 'session-id', project.id], project);
  const renamed = { ...project, name: 'New name' };
  update.mockResolvedValue({ data: renamed, error: null });
  getFullOrganization.mockResolvedValue({ data: renamed, error: null });
  list.mockResolvedValue({ projects: [renamed], nextCursor: null });
  const detail = TestBed.createComponent(ProjectPage);
  detail.componentRef.setInput('projectId', project.id);
  await detail.whenStable();
  const input: HTMLInputElement =
    detail.nativeElement.querySelector('#rename-project');
  input.value = 'New name';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await detail.whenStable();
  detail.componentInstance.rename(new Event('submit'));
  await vi.waitFor(() => expect(detail.componentInstance.busy()).toBe(false));
  expect(update).toHaveBeenCalledWith({
    organizationId: project.id,
    data: { name: 'New name' },
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

test('returning to Projects immediately after acceptance shows the joined project', async () => {
  queryClient.setQueryData(['projects', 'session-id'], {
    pages: [{ projects: [], nextCursor: null }],
    pageParams: [undefined],
  });
  getInvitation.mockResolvedValue({
    data: {
      organizationName: project.name,
      role: 'viewer',
      expiresAt: new Date().toISOString(),
    },
    error: null,
  });
  acceptInvitation.mockResolvedValue({
    data: { member: { organizationId: project.id } },
    error: null,
  });
  list.mockResolvedValue({ projects: [project], nextCursor: null });
  const invite = TestBed.createComponent(InvitationPage);
  invite.componentRef.setInput('invitationId', 'invite-id');
  await invite.whenStable();
  await invite.componentInstance.accept();
  invite.destroy();
  const projects = TestBed.createComponent(ProjectsPage);
  await vi.waitFor(async () => {
    await projects.whenStable();
    expect(projects.nativeElement.textContent).toContain('Old name');
  });
  expect(list).toHaveBeenCalledTimes(1);
});

test('unverified users can request verification and return to the invitation after confirming their email', async () => {
  session.update((s) => ({
    data: { ...s.data, user: { ...s.data.user, emailVerified: false } },
  }));
  sendVerificationEmail.mockResolvedValue({
    data: { status: true },
    error: null,
  });
  const invite = TestBed.createComponent(InvitationPage);
  invite.componentRef.setInput('invitationId', 'invite-id');
  await invite.whenStable();
  expect(getInvitation).not.toHaveBeenCalled();
  expect(invite.nativeElement.textContent).toContain('Send verification email');
  expect(invite.nativeElement.textContent).not.toContain('Accept invitation');
  await invite.componentInstance.sendVerification();
  expect(sendVerificationEmail).toHaveBeenCalledWith({
    email: 'admin@example.com',
    callbackURL: expect.stringMatching(
      /^https?:\/\/[^/]+\/invitations\/invite-id$/,
    ),
  });
  getInvitation.mockResolvedValue({
    data: {
      organizationName: project.name,
      role: 'viewer',
      expiresAt: new Date().toISOString(),
    },
    error: null,
  });
  session.update((s) => ({
    data: { ...s.data, user: { ...s.data.user, emailVerified: true } },
  }));
  await vi.waitFor(async () => {
    await invite.whenStable();
    expect(invite.nativeElement.textContent).toContain('Accept invitation');
  });
  expect(getInvitation).toHaveBeenCalledTimes(1);
});

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
