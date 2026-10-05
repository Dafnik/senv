import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, vi } from 'vite-plus/test';
import { appRoutes } from '../../app.routes';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { DeploymentUpload } from '../../queries/deployment-upload';
import { DeploymentsData } from '../../queries/deployments';
import { TrpcService } from '../../trpc/trpc.service';
import { deploymentData } from './project-routing.fixture';
import { artifactApi } from './artifact-routing.fixture';

let queries: QueryClient;

export function setupProjectRoutingTests() {
  afterEach(() => {
    queries?.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}

export async function createProjectHarness() {
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
    .find((candidate) =>
      candidate.children?.some(
        (child) => child.path === 'projects/:projectSlug',
      ),
    )!
    .children!.find((candidate) => candidate.path === 'projects/:projectSlug')!;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
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
            artifacts: artifactApi,
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
  return RouterTestingHarness.create();
}
