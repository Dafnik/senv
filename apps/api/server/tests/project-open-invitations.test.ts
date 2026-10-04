import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { invitation, member, user } from '../../../../drizzle/schema.ts';
import {
  account,
  auth,
  db,
  invite,
  outsider,
  project,
  projectCaller,
  recipient,
  recipientId,
} from './projects.test-support.ts';

test('open invitation pagination counts only pending unexpired invitations', async () => {
  const inviterId = db
    .select()
    .from(member)
    .where(eq(member.organizationId, project.id))
    .get()!.userId;
  for (let index = 0; index < 105; index++) {
    db.insert(invitation)
      .values({
        id: `open-${index}`,
        organizationId: project.id,
        inviterId,
        email: `open-${String(index).padStart(3, '0')}@example.com`,
        role: 'viewer',
        expiresAt: new Date(Date.now() + 3600000),
      })
      .run();
  }
  const caller = projectCaller();
  const first = await caller.invitations({
    projectId: project.id,
    limit: 100,
    sortBy: 'email',
    sortDirection: 'asc',
  });
  const second = await caller.invitations({
    projectId: project.id,
    offset: 100,
    sortBy: 'email',
    sortDirection: 'asc',
  });
  expect(first.total).toBe(105);
  expect(first.invitations).toHaveLength(100);
  expect(second.total).toBe(105);
  expect(second.invitations).toHaveLength(5);
  expect(new Set([...first.invitations, ...second.invitations].map((i) => i.id)).size).toBe(105);
});

test('open invitations show their sender and sort by inviter name without requiring inviter membership', async () => {
  await invite();
  const instance = await account('instance@example.com');
  db.update(user).set({ role: 'admin' }).where(eq(user.id, instance.id)).run();
  await projectCaller(instance.headers).invite({
    projectId: project.id,
    email: 'next@example.com',
    role: 'developer',
  });
  const result = await projectCaller().invitations({
    projectId: project.id,
    sortBy: 'invitedByName',
    sortDirection: 'asc',
  });
  expect(result.total).toBe(2);
  expect(result.invitations.map((i) => i.invitedByName)).toEqual([
    'admin@example.com',
    'instance@example.com',
  ]);
  expect(result.invitations[1].invitedById).toBe(instance.id);
  expect(result.invitations[1].email).toBe('next@example.com');
});

test('recipients can open invitations sent by instance admins outside the project, then accept them', async () => {
  const instance = await account('instance@example.com');
  db.update(user).set({ role: 'admin' }).where(eq(user.id, instance.id)).run();
  const invited = await projectCaller(instance.headers).invite({
    projectId: project.id,
    email: 'recipient@example.com',
    role: 'admin',
  });
  const lookup = { invitationId: invited.id };
  await expect(projectCaller(new Headers()).invitation(lookup)).rejects.toMatchObject({
    code: 'UNAUTHORIZED',
  });
  await expect(projectCaller(outsider).invitation(lookup)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  db.update(user).set({ emailVerified: false }).where(eq(user.id, recipientId)).run();
  await expect(projectCaller(recipient).invitation(lookup)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  db.update(user).set({ emailVerified: true }).where(eq(user.id, recipientId)).run();
  expect(await projectCaller(recipient).invitation(lookup)).toMatchObject({
    organizationName: project.name,
    role: 'admin',
  });
  await auth.api.acceptInvitation({ headers: recipient, body: lookup });
  await expect(projectCaller(recipient).invitation(lookup)).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(
    (await projectCaller(recipient).detail({ projectId: project.id })).members.find(
      (m) => m.userId === recipientId,
    )?.role,
  ).toBe('admin');
});

test.each(['canceled', 'expired'] as const)(
  'recipients cannot open %s invitation links',
  async (state) => {
    const invited = await invite();
    db.update(invitation)
      .set(
        state === 'expired' ? { expiresAt: new Date(Date.now() - 1000) } : { status: 'canceled' },
      )
      .where(eq(invitation.id, invited.id))
      .run();
    await expect(
      projectCaller(recipient).invitation({ invitationId: invited.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  },
);
