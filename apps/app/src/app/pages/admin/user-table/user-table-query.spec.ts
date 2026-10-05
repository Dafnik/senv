import { TestBed } from '@angular/core/testing';
import { expect, test, vi } from 'vite-plus/test';
import {
  alice,
  auth,
  bob,
  createTable,
  queryClient,
  session,
  setupUserTableTests,
} from './user-table.spec-support';
import { UserTable } from './user-table';

setupUserTableTests();
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
