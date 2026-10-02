import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT, injectAuthUser, injectLogout } from './auth-client';
import { AuthState } from './auth-state';
import { SessionRecovery, safeRedirect } from './session-recovery';

let state: {
  data: { session: { id: string }; user: { id: string } } | null;
  error: unknown;
  isPending: boolean;
  refetch: ReturnType<typeof vi.fn>;
};
let queries: QueryClient;
beforeEach(() => {
  state = {
    data: { session: { id: 'old-session' }, user: { id: 'old-user' } },
    error: null,
    isPending: false,
    refetch: vi.fn().mockResolvedValue(undefined),
  };
  queries = new QueryClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AUTH_CLIENT, useValue: { useSession: () => () => state } },
      { provide: QueryClient, useValue: queries },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
});
test('resolved refresh errors retain the recovery expectation, hide identity and clear previous data until retry succeeds', async () => {
  const user = TestBed.runInInjectionContext(injectAuthUser);
  const recovery = TestBed.inject(SessionRecovery);
  queries.setQueryData(['project', 'old-session'], { name: 'Private' });
  state.refetch.mockImplementationOnce(async () => {
    state.error = { message: 'Offline' };
  });
  await expect(
    recovery.refresh(
      (session) => session?.user.id === 'new-user',
      '/invitations/invite-id',
    ),
  ).rejects.toThrow('Your session could not be confirmed');
  expect(user()).toBeNull();
  expect(queries.getQueryCache().getAll()).toHaveLength(0);
  expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
    ['/unavailable'],
    { queryParams: { redirect: '/invitations/invite-id' }, replaceUrl: true },
  );
  state.refetch.mockImplementationOnce(async () => {
    state.error = null;
  });
  await expect(recovery.refresh()).rejects.toThrow();
  expect(TestBed.inject(AuthState).blocked()).toBe(true);
  state.refetch.mockImplementationOnce(async () => {
    state.data = { session: { id: 'new-session' }, user: { id: 'new-user' } };
  });
  await recovery.refresh();
  expect(TestBed.inject(AuthState).blocked()).toBe(false);
  expect(user()?.id).toBe('new-user');
});
test.each([
  'https://example.com',
  '//example.com',
  '/login?redirect=/login',
  '/signup?token=secret',
  '/unavailable',
  '/\\example.com',
])('unsafe redirect %s falls back to Projects', (value) =>
  expect(safeRedirect(value)).toBe('/projects'),
);
test('invitation and section redirects retain their destination', () => {
  expect(safeRedirect('/invitations/invite-id')).toBe('/invitations/invite-id');
  expect(safeRedirect('/projects/project-id/settings')).toBe(
    '/projects/project-id/settings',
  );
});

test('switching accounts signs out, confirms a null session and preserves the invitation through login', async () => {
  const signOut = vi
    .fn()
    .mockResolvedValue({ data: { success: true }, error: null });
  const client = TestBed.inject(AUTH_CLIENT);
  Object.assign(client, { signOut });
  state.refetch.mockImplementationOnce(async () => {
    state.data = null;
  });
  const logout = TestBed.runInInjectionContext(injectLogout);
  await logout('/invitations/invite-id');
  expect(signOut).toHaveBeenCalledOnce();
  expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/login'], {
    queryParams: { redirect: '/invitations/invite-id' },
    replaceUrl: true,
  });
  expect(TestBed.inject(AuthState).blocked()).toBe(false);
});
