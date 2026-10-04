import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AccountPassword } from '../../../auth/account-password';
import { AuthState } from '../../../auth/auth-state';
import { AccountSignup } from '../../../auth/account-signup';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { UserActionDropdown } from './user-action-dropdown';

const resend = vi.fn();
const auth = {
  admin: { removeUser: vi.fn(), impersonateUser: vi.fn() },
  refetch: vi.fn(),
};

let queryClient: QueryClient;
let sessionState: {
  data: {
    user: { id: string; role?: string };
    session: { id: string; impersonatedBy?: string };
  };
  error: unknown;
  refetch: typeof auth.refetch;
};
beforeEach(() => {
  auth.admin.removeUser.mockReset();
  auth.admin.impersonateUser.mockReset();
  sessionState = {
    data: {
      user: { id: 'admin', role: 'admin' },
      session: { id: 'admin-session' },
    },
    error: null,
    refetch: auth.refetch,
  };
  auth.refetch.mockReset().mockImplementation(async () => {
    sessionState.data = {
      user: { id: 'target', role: 'user' },
      session: { id: 'target-session', impersonatedBy: 'admin' },
    };
  });
  resend.mockReset();
  queryClient = new QueryClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AccountPassword, useValue: { adminReset: vi.fn() } },
      { provide: AccountSignup, useValue: { resend } },
      { provide: QueryClient, useValue: queryClient },
      {
        provide: AUTH_CLIENT,
        useValue: {
          admin: auth.admin,
          useSession: () => () => sessionState,
        },
      },
    ],
  });
  vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  vi.spyOn(toast, 'error').mockReturnValue('test-toast');
});
afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function dropdown() {
  const fixture = TestBed.createComponent(UserActionDropdown);
  fixture.componentRef.setInput('row', {
    original: { id: 'target', name: 'Target', role: 'user' },
  });
  return fixture.componentInstance;
}

test('keeps confirmation open when deletion fails, then closes after a successful retry', async () => {
  const component = dropdown();
  const dialog = { close: vi.fn() };
  auth.admin.removeUser.mockResolvedValue({
    data: null,
    error: { message: 'Deletion denied' },
  });
  await component.deleteUser(dialog);
  expect(dialog.close).not.toHaveBeenCalled();
  expect(component['deleting']()).toBe(false);
  expect(toast.error).toHaveBeenCalledWith('Deletion denied');
  auth.admin.removeUser.mockResolvedValue({
    data: { success: true },
    error: null,
  });
  await component.deleteUser(dialog);
  expect(dialog.close).toHaveBeenCalledOnce();
});

test('does not start another deletion while the first request is pending', async () => {
  let resolve!: (value: unknown) => void;
  auth.admin.removeUser.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const component = dropdown();
  const dialog = { close: vi.fn() };
  const first = component.deleteUser(dialog);
  await component.deleteUser(dialog);
  expect(auth.admin.removeUser).toHaveBeenCalledOnce();
  resolve({ data: { success: true }, error: null });
  await first;
});

test('refreshes the impersonated session before navigating', async () => {
  auth.admin.impersonateUser.mockResolvedValue({
    data: { user: { id: 'target' } },
    error: null,
  });
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  await dropdown().impersonate();
  expect(auth.refetch).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledWith('/projects', { replaceUrl: true });
  expect(auth.refetch.mock.invocationCallOrder[0]).toBeLessThan(
    navigate.mock.invocationCallOrder[0],
  );
});

test('does not navigate or refresh the session when impersonation fails', async () => {
  auth.admin.impersonateUser.mockResolvedValue({
    data: null,
    error: { message: 'Impersonation denied' },
  });
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  await dropdown().impersonate();
  expect(navigate).not.toHaveBeenCalled();
  expect(auth.refetch).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith('Impersonation denied');
});

test('resends signup for the selected user and reports delivery errors', async () => {
  const component = dropdown();
  resend.mockRejectedValueOnce(new Error('Mail unavailable'));
  await component.resendSignup();
  expect(resend).toHaveBeenCalledWith('target');
  expect(toast.error).toHaveBeenCalledWith('Mail unavailable');
  expect(component['sendingSignup']()).toBe(false);
  resend.mockResolvedValueOnce({ status: true });
  await component.resendSignup();
  expect(resend).toHaveBeenCalledTimes(2);
});

test('reports clipboard permission failures when copying the user ID', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('denied'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await dropdown().copyUserId();
  expect(writeText).toHaveBeenCalledWith('target');
  expect(toast.error).toHaveBeenCalledWith(
    'Could not copy the user ID. Check clipboard permissions.',
  );
});

test('a resolved refetch with an error hides old identity, clears cached users and blocks project navigation', async () => {
  queryClient.setQueryData(['users', 'admin-session'], {
    users: [{ id: 'sensitive' }],
  });
  auth.admin.impersonateUser.mockResolvedValue({
    data: { user: { id: 'target' } },
    error: null,
  });
  auth.refetch.mockImplementationOnce(async () => {
    sessionState.error = { message: 'Offline' };
  });
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigateByUrl')
    .mockResolvedValue(true);
  await dropdown().impersonate();
  expect(navigate).not.toHaveBeenCalled();
  expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(
    ['/unavailable'],
    expect.objectContaining({ replaceUrl: true }),
  );
  expect(TestBed.inject(AuthState).blocked()).toBe(true);
  expect(queryClient.getQueryData(['users', 'admin-session'])).toBeUndefined();
});
