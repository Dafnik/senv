import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  withComponentInputBinding,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { appRoutes } from '../../app.routes';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { DeploymentUpload } from '../../queries/deployment-upload';
import { DeploymentsData } from '../../queries/deployments';
import { TrpcService } from '../../trpc/trpc.service';
import { DeploymentDetail } from './deployment-detail';
import { ProjectPage } from './project-page/project-page.page';

let queries: QueryClient;
const deployment = {
  id: 'acf379',
  projectId: 'project-id',
  kind: 'static',
  status: 'healthy',
  desiredState: 'running',
  pinned: false,
  artifactId: 'artifact-id',
  imageDigest: null,
  source: { commit: 'abc123' },
  submittedAt: new Date(),
  readyAt: new Date(),
  retentionStartedAt: new Date(),
  retentionDeadlineAt: new Date('2026-10-10'),
  failureReason: null,
  removalPending: false,
  configurationOutdated: true,
  configurationChanges: ['Health checks'],
  previewUrl: 'https://acf379.project-preview.preview.example.test',
  config: {
    port: 80,
    env: {},
    spaFallback: false,
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
    limits: {
      origin: { cpus: '1', memoryBytes: 536870912 },
      proxy: { cpus: '0.1', memoryBytes: 67108864 },
    },
    logs: { files: 3, fileSizeBytes: 10485760 },
    secretNames: [],
    hasSecrets: false,
  },
  branchAlias: null,
  tags: [],
  history: [
    {
      id: 'event-id',
      projectId: 'project-id',
      deploymentId: 'acf379',
      event: 'published',
      actorType: 'user',
      actor: { id: 'admin', name: 'Ada' },
      details: {},
      createdAt: new Date(),
    },
  ],
};

const deploymentData = {
  detail: vi.fn((_sessionId: string, projectId: string, id: string) => ({
    queryKey: ['detail', projectId, id],
    enabled: !!projectId && !!id,
    queryFn: async () => deployment,
    refetchInterval: false,
  })),
  runtime: () => ({
    queryKey: ['runtime'],
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
      baseDomain: 'preview.example.test',
    }),
  }),
  credentials: () => ({
    queryKey: ['credentials'],
    enabled: false,
    queryFn: async () => [],
  }),
  adminDefaults: () => ({
    queryKey: ['defaults'],
    queryFn: async () => ({
      uploadLimitBytes: 104857600,
      proxyCpus: '0.1',
      proxyMemoryBytes: 67108864,
      logFiles: 3,
      logFileSizeBytes: 10485760,
    }),
  }),
  logs: (
    _sessionId: string,
    projectId: string,
    id: string,
    source: string,
  ) => ({
    queryKey: ['logs', projectId, id, source],
    enabled: !!projectId && !!id,
    initialPageParam: undefined as
      { createdAt: number; id: string } | undefined,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: { createdAt: number; id: string } | undefined;
    }) => ({
      logs: [
        {
          id: pageParam ? 'older' : 'latest',
          createdAt: new Date(pageParam ? 0 : 1000),
          content: pageParam
            ? `older ${source} output`
            : `latest ${source} output`,
        },
      ],
      nextCursor: pageParam ? null : { createdAt: 1000, id: 'latest' },
    }),
    getNextPageParam: (page: {
      nextCursor: { createdAt: number; id: string } | null;
    }) => page.nextCursor ?? undefined,
  }),
  invalidate: vi.fn(async () => undefined),
};
afterEach(() => {
  queries?.clear();
  vi.unstubAllGlobals();
});
test('project section URLs support direct links and the base URL redirects to Deployments', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const route = appRoutes
    .find((route) =>
      route.children?.some((child) => child.path === 'projects/:projectSlug'),
    )!
    .children!.find((route) => route.path === 'projects/:projectSlug')!;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([route], withComponentInputBinding()),
      provideTanStackQuery(() => queries),
      { provide: DeploymentsData, useValue: deploymentData },
      {
        provide: DeploymentUpload,
        useValue: { archive: vi.fn(), directory: vi.fn() },
      },
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: () => () => ({
            data: {
              session: { id: 'admin-session' },
              user: { id: 'admin', role: 'admin' },
            },
          }),
        },
      },
      {
        provide: TrpcService,
        useValue: {
          client: {
            projects: {
              bySlug: {
                query: vi.fn().mockResolvedValue({
                  id: 'project-id',
                  name: 'Project',
                  previewSlug: 'project-preview',
                  members: [],
                }),
              },
              invitations: {
                query: vi.fn().mockResolvedValue({ invitations: [], total: 0 }),
              },
            },
          },
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const members = await harness.navigateByUrl(
    '/projects/project-preview/members',
    ProjectPage,
  );
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
  expect(harness.routeNativeElement?.textContent).toContain('Health checks');
  expect(harness.routeNativeElement?.textContent).toContain('Ada');
  expect(
    harness.routeNativeElement?.querySelector(
      '[aria-label="Breadcrumb"] a[href="/projects/project-preview/deployments"]',
    ),
  ).not.toBeNull();
  expect(
    harness.routeNativeElement?.querySelector(
      'a[href="/projects/project-preview/deployments/acf379/logs"]',
    ),
  ).not.toBeNull();

  const logs = await harness.navigateByUrl(
    '/projects/project-preview/deployments/acf379/logs?source=proxy',
    DeploymentDetail,
  );
  expect(logs.view()).toBe('logs');
  expect(logs.source()).toBe('proxy');
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(
      harness.routeNativeElement?.querySelector('pre[aria-label="Proxy logs"]')
        ?.textContent,
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
  const older = [
    ...harness.routeNativeElement!.querySelectorAll('button'),
  ].find((button) => button.textContent?.includes('Load older logs'))!;
  older.click();
  await vi.waitFor(() => {
    harness.detectChanges();
    const text =
      harness.routeNativeElement?.querySelector('pre')?.textContent ?? '';
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
      harness.routeNativeElement?.querySelector('pre[aria-label="Origin logs"]')
        ?.textContent,
    ).toContain('latest origin output');
  });
});
