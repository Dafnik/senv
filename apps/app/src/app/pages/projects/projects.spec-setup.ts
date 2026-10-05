import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { DeploymentUpload } from '../../queries/deployment-upload';
import { DeploymentsData } from '../../queries/deployments';
import { TrpcService } from '../../trpc/trpc.service';

export const project = {
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
export const session = signal({
  data: {
    session: { id: 'session-id' },
    user: { id: 'user-id', email: 'admin@example.com', emailVerified: true },
  },
});
export const list = vi.fn();
export const listInvitations = vi.fn();
export const update = vi.fn();
export const createProject = vi.fn();
export const suggestPreviewSlug = vi.fn();
export const removeMember = vi.fn();
export const getFullOrganization = vi.fn();
export const getInvitation = vi.fn();
export const acceptInvitation = vi.fn();
export const sendVerificationEmail = vi.fn();
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
  history: (
    sessionId: string,
    input: { projectId: string; deploymentId?: string },
  ) => ({
    queryKey: [
      'history',
      sessionId,
      input.projectId,
      input.deploymentId ?? null,
    ],
    queryFn: async () => ({
      entries: [],
      total: 0,
      events: [],
      actors: [],
    }),
  }),
  settings: () => ({
    queryKey: ['settings'],
    queryFn: async () => ({
      spaFallback: false,
      repository: '',
      repositoryProvider: 'github',
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
export let queryClient: QueryClient;

export function setupProjectTests() {
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
        user: {
          id: 'user-id',
          email: 'admin@example.com',
          emailVerified: true,
        },
      },
    });
    listInvitations.mockResolvedValue({ invitations: [], total: 0 });
    suggestPreviewSlug.mockImplementation(
      async ({ name }: { name: string }) => ({
        previewSlug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      }),
    );
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
}
