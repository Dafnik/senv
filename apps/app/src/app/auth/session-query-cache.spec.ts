import { TestBed } from '@angular/core/testing';
import { QueryClient } from '@tanstack/angular-query';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, expect, test } from 'vite-plus/test';
import { AUTH_CLIENT } from './auth-client';
import { watchSessionQueryCache } from './session-query-cache';

type SessionState = {
  isPending: boolean;
  data: { session: { id: string } } | null;
};
let state: BehaviorSubject<SessionState>;
let queryClient: QueryClient;

beforeEach(() => {
  state = new BehaviorSubject<SessionState>({
    isPending: false,
    data: { session: { id: 'admin-session' } },
  });
  queryClient = new QueryClient();
  TestBed.configureTestingModule({
    providers: [
      { provide: QueryClient, useValue: queryClient },
      { provide: AUTH_CLIENT, useValue: { useSession: () => state } },
    ],
  });
  TestBed.runInInjectionContext(watchSessionQueryCache);
  queryClient.setQueryData(['me', 'admin-session'], { id: 'admin' });
  queryClient.setQueryData(
    ['users', 'admin-session'],
    [{ id: 'private-user' }],
  );
});

afterEach(() => {
  state.complete();
  queryClient.clear();
});

test.each(['impersonated-session', null])(
  'removes cached authenticated data on session change to %s',
  (id) => {
    state.next({ isPending: false, data: id ? { session: { id } } : null });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  },
);

test('keeps data during pending state and refreshes of the same session', () => {
  state.next({ isPending: true, data: null });
  state.next({ isPending: false, data: { session: { id: 'admin-session' } } });
  expect(queryClient.getQueryData(['me', 'admin-session'])).toEqual({
    id: 'admin',
  });
});

test('stops watching when the application injector is destroyed', () => {
  TestBed.resetTestingModule();
  state.next({ isPending: false, data: null });
  expect(queryClient.getQueryData(['me', 'admin-session'])).toEqual({
    id: 'admin',
  });
});
