import { toast } from '@spartan-ng/brain/sonner';
import { expect, test, vi } from 'vite-plus/test';
import {
  alice,
  auth,
  bob,
  createTable,
  queryClient,
  setupUserTableTests,
} from './user-table.spec-support';

setupUserTableTests();
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
