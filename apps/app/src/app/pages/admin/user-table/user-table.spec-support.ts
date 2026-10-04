import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { AccountSignup } from '../../../auth/account-signup';
import { UserTable } from './user-table';

export const auth = {
  admin: { listUsers: vi.fn(), removeUser: vi.fn() },
};
export let session = signal({
  data: { session: { id: 'admin-session' }, user: { id: 'admin' } },
});
vi.mock('@tanstack/angular-table-devtools', () => ({
  injectTanStackTableDevtools: () => undefined,
}));

export const alice = {
  id: 'alice',
  name: 'Alice',
  email: 'alice@example.com',
  role: 'user',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
export const bob = {
  ...alice,
  id: 'bob',
  name: 'Bob',
  email: 'bob@example.com',
};
export let queryClient: QueryClient;

export function setupUserTableTests() {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    auth.admin.listUsers.mockReset().mockResolvedValue({
      data: { users: [alice, bob], total: 2 },
      error: null,
    });
    auth.admin.removeUser
      .mockReset()
      .mockResolvedValue({ data: { success: true }, error: null });
    session = signal({
      data: { session: { id: 'admin-session' }, user: { id: 'admin' } },
    });
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.spyOn(toast, 'error').mockReturnValue('test-toast');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AccountSignup, useValue: { resend: vi.fn() } },
        provideTanStackQuery(() => queryClient),
        {
          provide: AUTH_CLIENT,
          useValue: { ...auth, useSession: () => session },
        },
      ],
    });
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
}

export async function createTable() {
  const fixture = TestBed.createComponent(UserTable);
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect(fixture.componentInstance['_table'].getRowModel().rows).toHaveLength(
      2,
    );
  });
  return fixture;
}
