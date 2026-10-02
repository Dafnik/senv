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
import { TrpcService } from '../../trpc/trpc.service';
import { ProjectPage } from './project-page/project-page.page';

let queries: QueryClient;
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
      route.children?.some((child) => child.path === 'projects/:projectId'),
    )!
    .children!.find((route) => route.path === 'projects/:projectId')!;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([route], withComponentInputBinding()),
      provideTanStackQuery(() => queries),
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
              detail: {
                query: vi.fn().mockResolvedValue({
                  id: 'project-id',
                  name: 'Project',
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
    '/projects/project-id/members',
    ProjectPage,
  );
  expect(members.projectId()).toBe('project-id');
  expect(members.section()).toBe('members');
  await vi.waitFor(() => {
    harness.detectChanges();
    expect(
      harness.routeNativeElement?.querySelector('app-project-members'),
    ).not.toBeNull();
  });
  const settings = await harness.navigateByUrl(
    '/projects/project-id/settings',
    ProjectPage,
  );
  expect(settings).toBe(members);
  expect(settings.section()).toBe('settings');
  harness.detectChanges();
  expect(
    harness.routeNativeElement?.querySelector('#rename-project'),
  ).not.toBeNull();
  await harness.navigateByUrl('/projects/project-id', ProjectPage);
  expect(TestBed.inject(Router).url).toBe('/projects/project-id/deployments');
  await harness.navigateByUrl('/projects/project-id/members', ProjectPage);
  expect(TestBed.inject(Router).url).toBe('/projects/project-id/members');
});
