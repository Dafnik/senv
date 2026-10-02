import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { TrpcService } from '../../trpc/trpc.service';
import { AdminStats } from './admin-stats';

const stats = vi.fn();
let queries: QueryClient;
beforeEach(() => {
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stats.mockReset();
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(() => queries),
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: () => () => ({
            data: { session: { id: 'admin-session' } },
          }),
        },
      },
      {
        provide: TrpcService,
        useValue: { client: { admin: { stats: { query: stats } } } },
      },
    ],
  });
});
afterEach(() => queries.clear());
test('failed statistics render a local error and retry successfully', async () => {
  stats.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({
    totalUsers: 9,
    newUsersLast7Days: 2,
    newUsersTrend: 0,
  });
  const fixture = TestBed.createComponent(AdminStats);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.stats.isError()).toBe(true),
  );
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain(
    'Could not load user statistics.',
  );
  fixture.nativeElement.querySelector('button').click();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.stats.isSuccess()).toBe(true),
  );
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('Total Users');
  expect(fixture.nativeElement.textContent).toContain('9');
});
