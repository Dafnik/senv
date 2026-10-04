import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { invitation, member, organization } from '../../../../drizzle/schema.ts';
import {
  admin,
  auth,
  db,
  email,
  invite,
  outsider,
  project,
  projectCaller,
  recipient,
  request,
} from './projects.test-support.ts';

test('cursor pagination returns every membership beyond 100 with stable ordering and no outsider access', async () => {
  const creator = db.select().from(member).where(eq(member.organizationId, project.id)).get()!;
  for (let i = 0; i < 105; i++) {
    const id = `paged-project-${String(i).padStart(3, '0')}`;
    db.insert(organization)
      .values({ id, slug: id, name: id, previewSlug: id, createdAt: new Date(1000) })
      .run();
    db.insert(member)
      .values({
        id: `paged-member-${i}`,
        organizationId: id,
        userId: creator.userId,
        role: 'viewer',
      })
      .run();
  }
  const caller = projectCaller();
  const first = await caller.list({ limit: 40 });
  expect(first.projects).toHaveLength(40);
  expect(first.projects[0].id).toBe(project.id);
  const second = await caller.list({
    limit: 40,
    cursor: JSON.parse(JSON.stringify(first.nextCursor)),
  });
  const third = await caller.list({ limit: 40, cursor: second.nextCursor! });
  const ids = [...first.projects, ...second.projects, ...third.projects].map((p) => p.id);
  expect(ids).toHaveLength(106);
  expect(new Set(ids).size).toBe(106);
  expect(third.nextCursor).toBeNull();
  expect(await projectCaller(outsider).list({})).toEqual({ projects: [], nextCursor: null });
  await expect(projectCaller(new Headers()).list({})).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  await expect(caller.list({ limit: 101 })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

test('pending invites remain visible and cancellable after more than 100 historical invitations', async () => {
  const inviterId = db
    .select()
    .from(member)
    .where(eq(member.organizationId, project.id))
    .get()!.userId;
  for (let i = 0; i < 101; i++) {
    db.insert(invitation)
      .values({
        id: `historical-${i}`,
        organizationId: project.id,
        inviterId,
        email: 'recipient@example.com',
        role: 'viewer',
        status: 'canceled',
        createdAt: new Date(1000 + i),
        expiresAt: new Date(2000),
      })
      .run();
  }
  const current = await invite('developer');
  const caller = projectCaller();
  const pending = await caller.invitations({ projectId: project.id });
  expect(pending.total).toBe(1);
  expect(pending.invitations[0].id).toBe(current.id);
  const all = await caller.invitations({ projectId: project.id, offset: 100 });
  expect(all.total).toBe(1);
  expect(all.invitations).toHaveLength(0);
  const cancelled = await request('cancel-invitation', admin, {
    invitationId: pending.invitations[0].id,
  });
  expect(cancelled.status).toBe(200);
  expect((await caller.invitations({ projectId: project.id })).total).toBe(0);
});

test('invitation table queries filter and sort on the server and require project admin membership', async () => {
  const expired = await invite();
  db.update(invitation)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(invitation.id, expired.id))
    .run();
  const next = await auth.api.createInvitation({
    headers: admin,
    body: { organizationId: project.id, email: 'zebra@example.com', role: 'admin' },
  });
  const caller = projectCaller();
  expect(
    (await caller.invitations({ projectId: project.id })).invitations.map((i) => i.id),
  ).toEqual([next.id]);
  const result = await caller.invitations({
    projectId: project.id,
    search: 'ZEBRA',
  });
  expect(result.total).toBe(1);
  expect(result.invitations[0].id).toBe(next.id);
  expect(
    (
      await caller.invitations({ projectId: project.id, sortBy: 'email', sortDirection: 'asc' })
    ).invitations.map((i) => i.email),
  ).toEqual(['zebra@example.com']);
  const viewerInvite = await invite();
  await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: viewerInvite.id } });
  await expect(
    projectCaller(recipient).invitations({ projectId: project.id }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    projectCaller(outsider).invitations({ projectId: project.id }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    projectCaller(new Headers()).invitations({ projectId: project.id }),
  ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
});

test.each(['owner', ['viewer', 'developer'], 'viewer,developer'])(
  'rejected replacement role %s preserves the valid invitation',
  async (role) => {
    const original = await invite();
    const rejected = await request('invite-member', admin, {
      organizationId: project.id,
      email: 'recipient@example.com',
      role,
    });
    expect(rejected.status).toBe(400);
    expect(db.select().from(invitation).where(eq(invitation.id, original.id)).get()?.status).toBe(
      'pending',
    );
    expect(email.getEmailNotifications()).toHaveLength(1);
    expect(
      (await request('accept-invitation', recipient, { invitationId: original.id })).status,
    ).toBe(200);
  },
);
