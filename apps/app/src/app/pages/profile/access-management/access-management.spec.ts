import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { TrpcService } from '../../../trpc/trpc.service';
import { AccessManagement } from './access-management';

const session = signal<{
  data: { session: { id: string } } | null;
  refetch?: () => Promise<void>;
}>({ data: { session: { id: 'browser' } } });
const sessions = vi.fn();
const tokens = vi.fn();
const createToken = vi.fn();
const revokeSession = vi.fn();
const revokeOthers = vi.fn();
const signOut = vi.fn();
const navigate = vi.fn();
const refetch = vi.fn(async () => session.set({ data: null }));
let queries: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  session.set({ data: { session: { id: 'browser' } } });
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sessions.mockResolvedValue([
    {
      id: 'cli',
      kind: 'cli',
      label: 'Work terminal',
      current: false,
      createdAt: new Date(),
      expiresAt: new Date(),
      lastActivityAt: new Date(),
    },
  ]);
  tokens.mockResolvedValue([]);
  createToken.mockResolvedValue({ secret: 'one-time-secret' });
  revokeSession.mockResolvedValue({ success: true });
  revokeOthers.mockResolvedValue({ success: true });
  signOut.mockResolvedValue({ data: { success: true }, error: null });
  navigate.mockResolvedValue(true);
  refetch.mockImplementation(async () => session.set({ data: null }));
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(() => queries),
      {
        provide: AUTH_CLIENT,
        useValue: { useSession: () => session, signOut },
      },
      { provide: Router, useValue: { navigate } },
      {
        provide: TrpcService,
        useValue: {
          client: {
            projects: {
              list: {
                query: vi.fn().mockResolvedValue({
                  projects: [
                    {
                      id: 'immutable-project',
                      name: 'Marketing site',
                      previewSlug: 'website',
                    },
                  ],
                  nextCursor: null,
                }),
              },
            },
            cli: {
              sessions: { query: sessions },
              tokens: { query: tokens },
              createToken: { mutate: createToken },
              project: {
                query: vi.fn().mockResolvedValue({ id: 'immutable-project' }),
              },
              revokeSession: { mutate: revokeSession },
              revokeOtherSessions: { mutate: revokeOthers },
            },
          },
        },
      },
    ],
  });
});
afterEach(() => {
  queries.clear();
  vi.unstubAllGlobals();
});

test('sessions show separate CLI metadata and revocation sends only the safe session ID', async () => {
  const fixture = TestBed.createComponent(AccessManagement);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.sessions.isSuccess()).toBe(true),
  );
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('Work terminal');
  await fixture.componentInstance.revokeSession('cli');
  expect(revokeSession).toHaveBeenCalledWith({ id: 'cli' });
});

test('automation secrets are displayed once and cleared when the signed-in session changes', async () => {
  const fixture = TestBed.createComponent(AccessManagement);
  fixture.componentInstance.tokenModel.set({
    name: 'CI',
    project: 'website',
    expiresInSeconds: 30 * 86400,
    permission: 'manage',
  });
  await fixture.componentInstance.createToken();
  expect(createToken).toHaveBeenCalledWith({
    name: 'CI',
    projectId: 'immutable-project',
    expiresInSeconds: 30 * 86400,
    permission: 'manage',
  });
  expect(fixture.componentInstance.secret()).toBe('one-time-secret');
  session.set({ data: { session: { id: 'different-browser' } } });
  expect(fixture.componentInstance.secret()).toBe('');
  expect(tokens).not.toHaveBeenCalledWith(
    expect.objectContaining({ secret: 'one-time-secret' }),
  );
});

test('a token response that arrives after account switching never displays the old account secret', async () => {
  let complete!: (value: { secret: string }) => void;
  createToken.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const fixture = TestBed.createComponent(AccessManagement);
  fixture.componentInstance.tokenModel.set({
    name: 'CI',
    project: 'website',
    expiresInSeconds: 30 * 86400,
    permission: 'read',
  });
  const request = fixture.componentInstance.createToken();
  await vi.waitFor(() => expect(createToken).toHaveBeenCalled());
  session.set({ data: { session: { id: 'different-browser' } } });
  complete({ secret: 'old-account-secret' });
  await request;
  expect(fixture.componentInstance.secret()).toBe('');
});

test('clearing lifetime creates a token with no expiry and project selection uses its immutable ID', async () => {
  const fixture = TestBed.createComponent(AccessManagement);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.projects.isSuccess()).toBe(true),
  );
  fixture.componentInstance.selectProject(
    fixture.componentInstance.projectOptions()[0],
  );
  fixture.componentInstance.tokenForm.name().value.set('Forever');
  await fixture.whenStable();
  const input = fixture.nativeElement.querySelector(
    '#token-expiry',
  ) as HTMLInputElement;
  expect(input.value).toBe('30');
  input.value = '';
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
  expect(input.value).toBe('');
  await fixture.componentInstance.createToken();
  expect(createToken).toHaveBeenCalledWith({
    name: 'Forever',
    projectId: 'immutable-project',
    permission: 'read',
    expiresInSeconds: null,
  });
  expect(
    fixture.nativeElement.querySelector('[role="combobox"]'),
  ).not.toBeNull();
});

test('session table sorts, paginates, and searches across all sessions', async () => {
  sessions.mockResolvedValue(
    Array.from({ length: 12 }, (_, index) => ({
      id: `cli-${index}`,
      kind: 'cli',
      label: `Device ${index}`,
      current: false,
      createdAt: new Date(index * 1000),
      expiresAt: new Date(1000000),
      lastActivityAt: new Date(index * 1000),
    })),
  );
  const fixture = TestBed.createComponent(AccessManagement);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.sessions.isSuccess()).toBe(true),
  );
  const component = fixture.componentInstance;
  expect(component.sessionTable.getRowModel().rows).toHaveLength(10);
  expect(component.sessionTable.getRowModel().rows[0].id).toBe('cli-11');
  component.sessionTable.setPageIndex(1);
  await fixture.whenStable();
  expect(component.sessionTable.getRowModel().rows).toHaveLength(2);
  component.sessionTable.setPageIndex(0);
  component.sessionSearch.set('Device 3');
  await fixture.whenStable();
  expect(
    component.sessionTable.getRowModel().rows.map((row) => row.id),
  ).toEqual(['cli-3']);
});

test('project combobox filters by slug and accepts a keyboard selection', async () => {
  const fixture = TestBed.createComponent(AccessManagement);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.projects.isSuccess()).toBe(true),
  );
  await fixture.whenStable();
  const input = fixture.nativeElement.querySelector(
    '#token-project',
  ) as HTMLInputElement;
  input.click();
  input.focus();
  input.value = 'website';
  input.dispatchEvent(new Event('input'));
  await fixture.whenStable();
  const option = document.querySelector<HTMLElement>(
    '[role="option"]:not([data-hidden])',
  )!;
  expect(option.textContent).toContain('Marketing site (website)');
  option.scrollIntoView = vi.fn();
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      keyCode: 40,
      bubbles: true,
    }),
  );
  await fixture.whenStable();
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }),
  );
  await fixture.whenStable();
  expect(fixture.componentInstance.tokenModel().project).toBe(
    'immutable-project',
  );
  expect(input.value).toBe('Marketing site (website)');
});

test('revoking the current session clears query caches and redirects to login', async () => {
  session.set({ data: { session: { id: 'browser' } }, refetch });
  const fixture = TestBed.createComponent(AccessManagement);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.sessions.isSuccess()).toBe(true),
  );
  queries.setQueryData(['private-account-data'], { secret: 'private' });
  await fixture.componentInstance.revokeSession('browser');
  expect(signOut).toHaveBeenCalledOnce();
  expect(revokeSession).not.toHaveBeenCalled();
  expect(queries.getQueryData(['private-account-data'])).toBeUndefined();
  expect(navigate).toHaveBeenCalledWith(
    ['/login'],
    expect.objectContaining({ replaceUrl: true }),
  );
});

test('revoke others refetches access metadata and expired tokens have safe project labels', async () => {
  const fixture = TestBed.createComponent(AccessManagement);
  await vi.waitFor(() =>
    expect(fixture.componentInstance.sessions.isSuccess()).toBe(true),
  );
  await vi.waitFor(() =>
    expect(fixture.componentInstance.projects.isSuccess()).toBe(true),
  );
  const previous = sessions.mock.calls.length;
  await fixture.componentInstance.revokeOthers();
  expect(revokeOthers).toHaveBeenCalledOnce();
  expect(sessions.mock.calls.length).toBeGreaterThan(previous);
  expect(fixture.componentInstance.projectLabel('immutable-project')).toContain(
    'Marketing site',
  );
  expect(fixture.componentInstance.tokenExpired(new Date(0))).toBe(true);
  expect(fixture.componentInstance.tokenExpired(null)).toBe(false);
});
