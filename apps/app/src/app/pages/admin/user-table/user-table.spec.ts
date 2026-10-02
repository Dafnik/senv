import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { UserTable } from './user-table';

const auth = {
  admin: { listUsers: vi.fn(), removeUser: vi.fn() },
};
let session = signal({
  data: { session: { id: 'admin-session' }, user: { id: 'admin' } },
});
vi.mock('@tanstack/angular-table-devtools', () => ({
  injectTanStackTableDevtools: () => undefined,
}));

const alice = {
  id: 'alice',
  name: 'Alice',
  email: 'alice@example.com',
  role: 'user',
  emailVerified: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const bob = { ...alice, id: 'bob', name: 'Bob', email: 'bob@example.com' };
let queryClient: QueryClient;

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

async function createTable() {
  const fixture = TestBed.createComponent(UserTable);
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect(fixture.componentInstance['_table'].getRowModel().rows).toHaveLength(
      2,
    );
  });
  return fixture;
}

test('deletes the selected account after the result order changes', async () => {
  const fixture = await createTable();
  const component = fixture.componentInstance;
  component['_table'].getRow('alice').toggleSelected(true);
  auth.admin.listUsers.mockResolvedValue({
    data: { users: [bob, alice], total: 2 },
    error: null,
  });
  await queryClient.invalidateQueries({ queryKey: ['users'] });
  await fixture.whenStable();
  expect(
    component['_table']
      .getSelectedRowModel()
      .rows.map((row) => row.original.id),
  ).toEqual(['alice']);
  const close = vi.fn();
  await component['deleteSelected'](close);
  expect(auth.admin.removeUser).toHaveBeenCalledExactlyOnceWith({
    userId: 'alice',
  });
  expect(close).toHaveBeenCalledOnce();
});

test.each([
  ['page', 2],
  ['size', 10],
  ['q', 'bob'],
  ['sort', 'email.desc'],
] as const)('clears selection when %s changes', async (input, value) => {
  const fixture = await createTable();
  const table = fixture.componentInstance['_table'];
  table.getRow('alice').toggleSelected(true);
  fixture.componentRef.setInput(input, value);
  await fixture.whenStable();
  expect(table.getSelectedRowModel().rows).toHaveLength(0);
  expect(auth.admin.removeUser).not.toHaveBeenCalled();
});

test('retains failed accounts selected after a partial bulk deletion', async () => {
  const fixture = await createTable();
  const component = fixture.componentInstance;
  component['_table'].toggleAllPageRowsSelected(true);
  await fixture.whenStable();
  expect(component['_table'].getSelectedRowModel().rows).toHaveLength(2);
  auth.admin.removeUser.mockImplementation(async ({ userId }) =>
    userId === 'alice'
      ? { data: { success: true }, error: null }
      : { data: null, error: { message: 'Deletion denied' } },
  );
  auth.admin.listUsers.mockResolvedValue({
    data: { users: [bob], total: 1 },
    error: null,
  });
  const close = vi.fn();
  await component['deleteSelected'](close);
  await fixture.whenStable();
  expect(
    component['_table']
      .getSelectedRowModel()
      .rows.map((row) => row.original.id),
  ).toEqual(['bob']);
  expect(close).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(
    expect.stringContaining('Deletion denied'),
  );
});

test('renders a failed request as an error and allows retrying', async () => {
  auth.admin.listUsers.mockResolvedValue({
    data: null,
    error: { message: 'Access denied' },
  });
  const fixture = TestBed.createComponent(UserTable);
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Could not load users');
  });
  expect(fixture.nativeElement.textContent).toContain('Access denied');
  expect(fixture.nativeElement.textContent).not.toContain('No users found');
  auth.admin.listUsers.mockResolvedValue({
    data: { users: [alice, bob], total: 2 },
    error: null,
  });
  const retry = Array.from(
    fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>,
  ).find((button) => button.textContent?.includes('Try again'))!;
  retry.click();
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Alice');
    expect(fixture.nativeElement.textContent).not.toContain(
      'Could not load users',
    );
  });
});

test('clears selection and cached users when the session changes', async () => {
  const fixture = await createTable();
  const table = fixture.componentInstance['_table'];
  table.getRow('alice').toggleSelected(true);
  auth.admin.listUsers.mockResolvedValue({
    data: { users: [], total: 0 },
    error: null,
  });
  session.set({
    data: { session: { id: 'different-session' }, user: { id: 'other-admin' } },
  });
  await vi.waitFor(async () => {
    await fixture.whenStable();
    expect(table.getRowModel().rows).toHaveLength(0);
  });
  expect(table.getSelectedRowModel().rows).toHaveLength(0);
});

test('shows a refresh failure even when older user data is cached', async () => {
  const fixture = await createTable();
  auth.admin.listUsers.mockResolvedValue({
    data: null,
    error: { message: 'Server unavailable' },
  });
  await queryClient.invalidateQueries({ queryKey: ['users'] });
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('Could not load users');
  expect(fixture.nativeElement.textContent).toContain('Server unavailable');
  expect(fixture.nativeElement.textContent).not.toContain('No users found');
});
