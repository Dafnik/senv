import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { DeploymentsData } from '../../queries/deployments';
import { DeploymentResources } from './deployment-resources';

let queries: QueryClient;
type ResourceSample =
  | {
      status: 'available';
      sampledAt: Date;
      cpuPercent: number;
      memoryUsedBytes: number;
      memoryLimitBytes: number | null;
    }
  | {
      status: 'unavailable';
      sampledAt: Date;
      reason: string;
    };

let sample: WritableSignal<ResourceSample>;
let failRefresh = false;
let holdSample = false;
let pendingSample: ((value: ResourceSample) => void) | undefined;

beforeEach(() => {
  failRefresh = false;
  holdSample = false;
  pendingSample = undefined;
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  sample = signal<ResourceSample>({
    status: 'available',
    sampledAt: new Date('2026-10-04T09:00:00Z'),
    cpuPercent: 43.4,
    memoryUsedBytes: 268_435_456,
    memoryLimitBytes: 536_870_912,
  });
  TestBed.configureTestingModule({
    imports: [DeploymentResources],
    providers: [
      provideTanStackQuery(() => queries),
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: () => () => ({ data: { session: { id: 'session' } } }),
        },
      },
      {
        provide: DeploymentsData,
        useValue: {
          resources: () => ({
            queryKey: ['resources', 'session', 'project', 'deployment'],
            enabled: true,
            queryFn: () => {
              if (failRefresh)
                return Promise.reject(new Error('Stats request failed'));
              if (holdSample) {
                return new Promise<ResourceSample>((resolve) => {
                  pendingSample = resolve;
                });
              }
              return Promise.resolve(sample());
            },
            refetchInterval: false,
          }),
        },
      },
    ],
  });
});

afterEach(() => {
  queries.clear();
  TestBed.resetTestingModule();
});

test('shows sampled CPU and memory values with accessible meters', async () => {
  const fixture = TestBed.createComponent(DeploymentResources);
  fixture.componentRef.setInput('projectId', 'project');
  fixture.componentRef.setInput('deploymentId', 'deployment');
  await fixture.whenStable();
  fixture.detectChanges();

  expect(fixture.nativeElement.textContent).toContain('43.4%');
  expect(fixture.nativeElement.textContent).toContain('256.0 MiB');
  expect(fixture.nativeElement.textContent).toContain('512.0 MiB limit');
  expect(fixture.nativeElement.querySelectorAll('[role="meter"]')).toHaveLength(
    1,
  );
});

test('explains unavailable stats without displaying zero usage', async () => {
  sample.set({
    status: 'unavailable',
    sampledAt: new Date(),
    reason: 'container-stopped',
  });
  const fixture = TestBed.createComponent(DeploymentResources);
  fixture.componentRef.setInput('projectId', 'project');
  fixture.componentRef.setInput('deploymentId', 'deployment');
  await fixture.whenStable();
  fixture.detectChanges();

  expect(fixture.nativeElement.textContent).toContain(
    'origin container is stopped',
  );
  expect(fixture.nativeElement.textContent).not.toContain('0%');
});

test('prior samples are hidden when a refresh fails', async () => {
  const fixture = TestBed.createComponent(DeploymentResources);
  fixture.componentRef.setInput('projectId', 'project');
  fixture.componentRef.setInput('deploymentId', 'deployment');
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('43.4%');

  failRefresh = true;
  await fixture.componentInstance.resources.refetch();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.resources.isError()).toBe(true),
  );
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('Stats request failed');
  expect(fixture.nativeElement.textContent).not.toContain('43.4%');
  expect(fixture.nativeElement.textContent).not.toContain('Updated');
});

test('shows a loading state while the first sample is pending', async () => {
  holdSample = true;
  const fixture = TestBed.createComponent(DeploymentResources);
  fixture.componentRef.setInput('projectId', 'project');
  fixture.componentRef.setInput('deploymentId', 'deployment');
  fixture.detectChanges();

  expect(
    fixture.nativeElement.querySelector(
      '[aria-label="Loading origin resource usage"]',
    ),
  ).not.toBeNull();
  await vi.waitFor(() => expect(pendingSample).toBeDefined());
  pendingSample?.(sample());
  await fixture.whenStable();
  fixture.destroy();
});
