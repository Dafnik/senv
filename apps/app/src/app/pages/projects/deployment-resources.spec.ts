import type { DeploymentResourceHistory } from '@senv/api/shared/deployment-resources';
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
let history: DeploymentResourceHistory;
let failHistory = false;
let failRefresh = false;
let holdSample = false;
let pendingSample: ((value: ResourceSample) => void) | undefined;

beforeEach(() => {
  failHistory = false;
  history = {
    from: new Date('2026-10-04T08:40:00Z'),
    to: new Date('2026-10-04T09:00:00Z'),
    intervalMs: 30_000,
    points: Array.from({ length: 40 }, (_, index) => ({
      sampledAt: new Date(Date.parse('2026-10-04T08:40:30Z') + index * 30_000),
      cpuPercent: index === 15 ? null : 20 + index,
      memoryUsedBytes: index === 15 ? null : (100 + index) * 1024 * 1024,
      memoryLimitBytes: 536_870_912,
    })),
  };
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
          resourceHistory: () => ({
            queryKey: ['resource-history', 'session', 'project', 'deployment'],
            queryFn: () =>
              failHistory
                ? Promise.reject(new Error('History request failed'))
                : Promise.resolve(history),
            refetchInterval: false,
          }),
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
  expect(
    fixture.nativeElement.querySelector('section').textContent,
  ).not.toContain('0%');
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

test('renders separate CPU and memory charts beneath current resources, including past samples when stopped', async () => {
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
  const charts = fixture.nativeElement.querySelectorAll('tanstack-chart svg');
  expect(charts).toHaveLength(2);
  expect(charts[0].getAttribute('aria-label')).toBe(
    'CPU usage over the last 20 minutes',
  );
  expect(charts[1].getAttribute('aria-label')).toBe(
    'Memory usage over the last 20 minutes',
  );
  expect(fixture.nativeElement.textContent).toContain('Last 20 minutes');
  expect(fixture.nativeElement.textContent).toContain(
    'Gaps indicate unavailable samples',
  );
});

test('shows empty history without plotting missing samples as zero', async () => {
  history.points = history.points.map((point) => ({
    ...point,
    cpuPercent: null,
    memoryUsedBytes: null,
  }));
  const fixture = TestBed.createComponent(DeploymentResources);
  fixture.componentRef.setInput('projectId', 'project');
  fixture.componentRef.setInput('deploymentId', 'deployment');
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('tanstack-chart')).toBeNull();
  expect(fixture.nativeElement.textContent).toContain('No CPU samples yet');
  expect(fixture.nativeElement.textContent).toContain('No Memory samples yet');
});

test('shows a retry action for history errors while retaining live usage', async () => {
  failHistory = true;
  const fixture = TestBed.createComponent(DeploymentResources);
  fixture.componentRef.setInput('projectId', 'project');
  fixture.componentRef.setInput('deploymentId', 'deployment');
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toContain('History request failed');
  expect(fixture.nativeElement.textContent).toContain('43.4%');
  failHistory = false;
  fixture.nativeElement
    .querySelector('app-deployment-resource-chart button')
    .click();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelectorAll('tanstack-chart')).toHaveLength(
    2,
  );
});
