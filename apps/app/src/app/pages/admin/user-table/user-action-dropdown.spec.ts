import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { UserActionDropdown } from './user-action-dropdown';

const auth = {
  admin: { removeUser: vi.fn(), impersonateUser: vi.fn() },
  refetch: vi.fn(),
};

let queryClient: QueryClient;
beforeEach(() => {
  auth.admin.removeUser.mockReset();
  auth.admin.impersonateUser.mockReset();
  auth.refetch.mockReset().mockResolvedValue(undefined);
  queryClient = new QueryClient();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: QueryClient, useValue: queryClient },
      {
        provide: AUTH_CLIENT,
        useValue: {
          admin: auth.admin,
          useSession: () => () => ({
            data: { user: { id: 'admin' } },
            refetch: auth.refetch,
          }),
        },
      },
    ],
  });
  vi.spyOn(toast, 'error').mockReturnValue('test-toast');
});
afterEach(() => {
  queryClient.clear();
  vi.restoreAllMocks();
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
