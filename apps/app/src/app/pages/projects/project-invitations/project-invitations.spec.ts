import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { TrpcService } from '../../../trpc/trpc.service';
import { ProjectInvitations } from './project-invitations';

const session = signal({
  data: { session: { id: 'session-id' }, user: { id: 'user-id' } },
});
const listInvitations = vi.fn();
const cancelInvitation = vi.fn();
let queryClient: QueryClient;
const pending = {
  id: 'latest-invite',
  email: 'recipient@example.com',
  role: 'viewer',
  invitedById: 'inviter-id',
  invitedByName: 'Inviting Admin',
  status: 'pending',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 86400000),
};

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
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  TestBed.configureTestingModule({
    providers: [
      provideTanStackQuery(() => queryClient),
      {
        provide: AUTH_CLIENT,
        useValue: {
          useSession: () => session,
          organization: { cancelInvitation },
        },
      },
      {
        provide: TrpcService,
        useValue: {
          client: {
            projects: {
              invitations: { query: listInvitations },
              cancelInvitation: { mutate: cancelInvitation },
            },
          },
        },
      },
    ],
  });
});
afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

function createTable() {
  const fixture = TestBed.createComponent(ProjectInvitations);
  fixture.componentRef.setInput('projectId', 'project-id');
  return fixture;
}

test('invitation table loads server pages beyond 100 open records and sends sort changes to the API', async () => {
  listInvitations.mockResolvedValue({ invitations: [pending], total: 121 });
  const fixture = createTable();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.table.getPageCount()).toBe(7),
  );
  fixture.componentInstance.table.setPageIndex(5);
  await vi.waitFor(() =>
    expect(listInvitations.mock.lastCall?.[0].offset).toBe(100),
  );
  fixture.componentInstance.table.setSorting([{ id: 'email', desc: false }]);
  await vi.waitFor(() =>
    expect(listInvitations.mock.lastCall?.[0]).toMatchObject({
      offset: 0,
      sortBy: 'email',
      sortDirection: 'asc',
    }),
  );
  fixture.componentInstance.table.setPagination({ pageIndex: 0, pageSize: 50 });
  await vi.waitFor(() =>
    expect(listInvitations.mock.lastCall?.[0].limit).toBe(50),
  );
  expect(fixture.componentInstance.table.getPageCount()).toBe(3);
});

test('email filters reset pagination and pending invitations can be cancelled', async () => {
  listInvitations.mockResolvedValue({ invitations: [pending], total: 121 });
  cancelInvitation.mockResolvedValue({ data: pending, error: null });
  const fixture = createTable();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.invitations.data()?.total).toBe(121),
  );
  fixture.componentInstance.table.setPageIndex(5);
  await vi.waitFor(() =>
    expect(listInvitations.mock.lastCall?.[0].offset).toBe(100),
  );
  fixture.componentInstance.search.set('recipient');
  await vi.waitFor(() =>
    expect(listInvitations.mock.lastCall?.[0]).toMatchObject({
      offset: 0,
      search: 'recipient',
    }),
  );
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('Invited by');
  expect(fixture.nativeElement.textContent).toContain('Inviting Admin');
  expect(fixture.nativeElement.textContent).toContain('Viewer');
  expect(
    fixture.nativeElement.querySelector(
      'button[aria-label="Cancel invitation for recipient@example.com"]',
    ),
  ).not.toBeNull();
  listInvitations.mockResolvedValue({ invitations: [], total: 0 });
  await fixture.componentInstance.cancel(pending.id);
  expect(cancelInvitation).toHaveBeenCalledWith({
    projectId: 'project-id',
    invitationId: pending.id,
  });
  await vi.waitFor(() =>
    expect(fixture.componentInstance.table.getRowModel().rows).toHaveLength(0),
  );
});

test('cancelling the last pending invitation on a filtered page returns to a valid page', async () => {
  listInvitations.mockResolvedValue({ invitations: [pending], total: 21 });
  cancelInvitation.mockResolvedValue({ data: pending, error: null });
  const fixture = createTable();
  await vi.waitFor(() =>
    expect(fixture.componentInstance.invitations.data()?.total).toBe(21),
  );
  fixture.componentInstance.table.setPageIndex(1);
  await vi.waitFor(() =>
    expect(listInvitations.mock.lastCall?.[0].offset).toBe(20),
  );
  listInvitations.mockImplementation(async ({ offset }) => ({
    invitations: offset ? [] : [pending],
    total: 20,
  }));
  await fixture.componentInstance.cancel(pending.id);
  await vi.waitFor(() =>
    expect(listInvitations.mock.lastCall?.[0].offset).toBe(0),
  );
  expect(fixture.componentInstance.pagination().pageIndex).toBe(0);
});
