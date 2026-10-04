import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { expect, test, vi } from 'vite-plus/test';
import {
  alice,
  auth,
  createTable,
  queryClient,
  setupUserTableTests,
} from './user-table.spec-support';
import { UserTable } from './user-table';

setupUserTableTests();
test('shared pagination updates the user table page size in its route', async () => {
  const fixture = await createTable();
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  fixture.componentInstance['_table'].setPagination({
    pageIndex: 0,
    pageSize: 50,
  });
  expect(navigate).toHaveBeenCalledWith([], {
    queryParams: { page: 1, size: 50 },
    queryParamsHandling: 'merge',
  });
});

test('deleting the last user on the final page repairs pagination and invalidates statistics', async () => {
  auth.admin.listUsers.mockResolvedValue({
    data: { users: [alice], total: 21 },
    error: null,
  });
  queryClient.setQueryData(['user-stats', 'admin-session'], { totalUsers: 21 });
  const fixture = TestBed.createComponent(UserTable);
  fixture.componentRef.setInput('page', 2);
  fixture.componentRef.setInput('size', 20);
  await vi.waitFor(() =>
    expect(fixture.componentInstance['_table'].getRowModel().rows).toHaveLength(
      1,
    ),
  );
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  fixture.componentInstance['_table'].getRow('alice').toggleSelected(true);
  auth.admin.listUsers.mockResolvedValue({
    data: { users: [], total: 20 },
    error: null,
  });
  await fixture.componentInstance['deleteSelected'](vi.fn());
  await vi.waitFor(() =>
    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { page: 1 },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    }),
  );
  expect(
    queryClient.getQueryState(['user-stats', 'admin-session'])?.isInvalidated,
  ).toBe(true);
});
