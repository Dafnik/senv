import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../auth/auth-client';
import { TrpcService } from '../../trpc/trpc.service';
import { DashboardPage } from './dashboard.page';

type SessionState = {
  data: { session: { id: string }; user: { id: string } } | null;
};
let session = signal<SessionState>({ data: null });
const me = vi.fn();
let queryClient: QueryClient;

beforeEach(() => {
  session = signal<SessionState>({
    data: { session: { id: 'admin-session' }, user: { id: 'admin' } },
  });
  me.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30000, retry: false } },
  });
  queryClient.setQueryData(['me', 'admin-session'], { id: 'admin' });
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(() => queryClient),
      { provide: AUTH_CLIENT, useValue: { useSession: () => session } },
      { provide: TrpcService, useValue: { client: { me: { query: me } } } },
    ],
  });
});
afterEach(() => queryClient.clear());

test('fetches the impersonated identity instead of reusing fresh cached admin data', async () => {
  const fixture = TestBed.createComponent(DashboardPage);
  await fixture.whenStable();
  expect(fixture.componentInstance.me.data()).toEqual({ id: 'admin' });
  expect(me).not.toHaveBeenCalled();
  me.mockResolvedValue({ id: 'target' });
  session.set({
    data: { session: { id: 'target-session' }, user: { id: 'target' } },
  });
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect(fixture.componentInstance.me.data()).toEqual({ id: 'target' });
  });
  expect(me).toHaveBeenCalledWith(undefined, {
    signal: expect.any(AbortSignal),
  });
});

test('does not fetch or display the cached identity after sign-out', async () => {
  const fixture = TestBed.createComponent(DashboardPage);
  await fixture.whenStable();
  session.set({ data: null });
  await fixture.whenStable();
  expect(fixture.componentInstance.me.data()).toBeUndefined();
  expect(me).not.toHaveBeenCalled();
});
