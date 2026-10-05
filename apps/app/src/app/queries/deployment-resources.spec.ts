import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { expect, test, vi } from 'vite-plus/test';
import { DeploymentsData } from './deployments';
import { TrpcService } from '../trpc/trpc.service';

test('resource queries scope by session and deployment, stop in the background, and pass cancellation', async () => {
  const request = vi.fn().mockResolvedValue({ status: 'unavailable' });
  const queryClient = new QueryClient();
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(() => queryClient),
      {
        provide: TrpcService,
        useValue: {
          client: {
            deployments: {
              resources: { query: request },
              resourceHistory: { query: request },
            },
          },
        },
      },
    ],
  });
  const data = TestBed.inject(DeploymentsData);
  const options = data.resources('session-a', 'project-a', 'deployment-a');

  expect(options.queryKey).toEqual([
    'deployment-resources',
    'session-a',
    'project-a',
    'deployment-a',
  ]);
  expect(options.enabled).toBe(true);
  expect(options.refetchInterval).toBe(2_000);
  expect(options.refetchIntervalInBackground).toBe(false);
  expect(data.resources(null, 'project-a', 'deployment-a').enabled).toBe(false);
  expect(
    data.resources('session-a', 'project-a', 'deployment-a', false).enabled,
  ).toBe(false);

  const history = data.resourceHistory(
    'session-a',
    'project-a',
    'deployment-a',
  );
  expect(history.queryKey).toEqual([
    'deployment-resource-history',
    'session-a',
    'project-a',
    'deployment-a',
  ]);
  expect(history.refetchInterval).toBe(30_000);
  expect(history.refetchIntervalInBackground).toBe(false);
  expect(data.resourceHistory(null, 'project-a', 'deployment-a').enabled).toBe(
    false,
  );
  expect(
    data.resourceHistory('session-a', 'project-a', 'deployment-a', false)
      .enabled,
  ).toBe(false);
  await queryClient.fetchQuery(history);
  await queryClient.fetchQuery(options);
  expect(request).toHaveBeenCalledWith(
    { projectId: 'project-a', deploymentId: 'deployment-a' },
    { signal: expect.any(AbortSignal) },
  );
});
