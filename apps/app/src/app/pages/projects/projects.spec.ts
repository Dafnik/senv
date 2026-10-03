import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { DeploymentUpload } from '../../queries/deployment-upload';
import { DeploymentsData } from '../../queries/deployments';
import { TrpcService } from '../../trpc/trpc.service';
import { InvitationPage } from './invitation-page/invitation-page.page';
import { ProjectPage } from './project-page/project-page.page';
import { ProjectsPage } from './projects-page/projects-page.page';

const project = {
  id: 'project-id',
  name: 'Old name',
  slug: 'project-id',
  previewSlug: 'old-name',
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
const createProject = vi.fn();
const suggestPreviewSlug = vi.fn();
const removeMember = vi.fn();
const getFullOrganization = vi.fn();
const getInvitation = vi.fn();
const acceptInvitation = vi.fn();
const sendVerificationEmail = vi.fn();
const deploymentDataMock = {
  runtime: () => ({
    queryKey: ['runtime'],
    enabled: true,
    queryFn: async () => ({ env: {}, secretNames: [] }),
  }),
  list: () => ({
    queryKey: ['deployments'],
    queryFn: async () => [],
    refetchInterval: false,
  }),
  history: () => ({ queryKey: ['history'], queryFn: async () => [] }),
  settings: () => ({
    queryKey: ['settings'],
    queryFn: async () => ({
      spaFallback: false,
      repository: '',
      retentionDays: 7,
      originCpus: '1',
      originMemoryBytes: 536870912,
      health: {
        path: '/',
        startupDeadlineSeconds: 60,
        intervalSeconds: 5,
        timeoutSeconds: 3,
        unhealthyThreshold: 3,
      },
      proxy: {
        routes: [],
        cacheRules: [],
        compression: { enabled: true, endings: [] },
      },
      baseDomain: 'preview.localhost',
    }),
  }),
  credentials: () => ({
    queryKey: ['credentials'],
    enabled: false,
    queryFn: async () => [],
  }),
  adminDefaults: () => ({
    queryKey: ['defaults'],
    enabled: false,
    queryFn: async () => ({
      uploadLimitBytes: 104857600,
      proxyCpus: '0.1',
      proxyMemoryBytes: 67108864,
      logFiles: 3,
      logFileSizeBytes: 10485760,
    }),
  }),
  logs: () => ({
    queryKey: ['logs'],
    enabled: false,
    initialPageParam: undefined,
    queryFn: async () => ({ logs: [], nextCursor: null }),
    getNextPageParam: () => undefined,
  }),
  invalidate: vi.fn(async () => undefined),
};
let queryClient: QueryClient;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  session.set({
    data: {
      session: { id: 'session-id' },
      user: { id: 'user-id', email: 'admin@example.com', emailVerified: true },
    },
  });
  listInvitations.mockResolvedValue({ invitations: [], total: 0 });
  suggestPreviewSlug.mockImplementation(async ({ name }: { name: string }) => ({
    previewSlug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  }));
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30000, retry: false } },
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: DeploymentsData, useValue: deploymentDataMock },
      {
        provide: DeploymentUpload,
        useValue: { archive: vi.fn(), directory: vi.fn() },
      },
      {
        provide: TrpcService,
        useValue: {
          client: {
            projects: {
              list: { query: list },
              create: { mutate: createProject },
              suggestPreviewSlug: { query: suggestPreviewSlug },
              invitations: { query: listInvitations },
              invitation: { query: getInvitation },
              detail: { query: getFullOrganization },
              bySlug: { query: getFullOrganization },
              rename: { mutate: update },
              changeMemberRole: { mutate: vi.fn() },
              removeMember: { mutate: removeMember },
              invite: { mutate: vi.fn() },
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
            acceptInvitation,
          },
        },
      },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
});
afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

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

test('returning to Projects immediately after acceptance shows the joined project', async () => {
  queryClient.setQueryData(['projects', 'session-id'], {
    pages: [{ projects: [], nextCursor: null }],
    pageParams: [undefined],
  });
  getInvitation.mockResolvedValue({
    organizationName: project.name,
    role: 'viewer',
    expiresAt: new Date().toISOString(),
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
    organizationName: project.name,
    role: 'viewer',
    expiresAt: new Date().toISOString(),
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
