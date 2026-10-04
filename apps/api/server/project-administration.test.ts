import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { invitation, member, organization, user } from '../../../drizzle/schema';
import {
  account,
  auth,
  db,
  email,
  invite,
  outsider,
  project,
  projectCaller,
  recipient,
  recipientId,
} from './projects.test-support';

test('instance admins list and manage every project without membership, including orphan recovery', async () => {
  const instance = await account('instance@example.com');
  db.update(user).set({ role: 'admin' }).where(eq(user.id, instance.id)).run();
  const caller = projectCaller(instance.headers);
  expect((await caller.list({})).projects.map((p) => p.id)).toContain(project.id);
  expect((await caller.detail({ projectId: project.id })).members).toHaveLength(1);
  await caller.rename({ projectId: project.id, name: 'Recovered name' });
  expect(db.select().from(organization).where(eq(organization.id, project.id)).get()!.name).toBe(
    'Recovered name',
  );
  const creator = db.select().from(user).where(eq(user.email, 'admin@example.com')).get()!;
  await auth.api.removeUser({ headers: instance.headers, body: { userId: creator.id } });
  expect((await caller.detail({ projectId: project.id })).members).toHaveLength(0);
  expect((await caller.list({})).projects.map((p) => p.id)).toContain(project.id);
  const recovery = await caller.invite({
    projectId: project.id,
    email: 'recipient@example.com',
    role: 'admin',
  });
  await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: recovery.id } });
  expect((await caller.invitations({ projectId: project.id })).total).toBe(0);
  const recovered = (await caller.detail({ projectId: project.id })).members[0];
  expect(recovered.role).toBe('admin');
  expect(recovered.invitedById).toBe(instance.id);
  expect(recovered.invitedByName).toBe('instance@example.com');
  await projectCaller(recipient).rename({ projectId: project.id, name: 'New admin can manage' });
  await caller.changeMemberRole({ projectId: project.id, memberId: recovered.id, role: 'viewer' });
  expect((await caller.detail({ projectId: project.id })).members[0].role).toBe('viewer');
  await caller.changeMemberRole({ projectId: project.id, memberId: recovered.id, role: 'admin' });
  await caller.removeMember({ projectId: project.id, memberId: recovered.id });
  expect((await caller.detail({ projectId: project.id })).members).toHaveLength(0);
  const created = await caller.invite({
    projectId: project.id,
    email: 'invited@example.com',
    role: 'admin',
  });
  expect(email.getEmailNotifications().some((m) => m.to === 'invited@example.com')).toBe(true);
  expect((await caller.invitations({ projectId: project.id })).total).toBe(1);
  await caller.cancelInvitation({ projectId: project.id, invitationId: created.id });
  expect(db.select().from(invitation).where(eq(invitation.id, created.id)).get()!.status).toBe(
    'canceled',
  );
});

test('project recovery remains inaccessible to ordinary outsiders and mutation IDs are scoped', async () => {
  const caller = projectCaller(outsider);
  expect((await caller.list({})).projects).toEqual([]);
  for (const action of [
    () => caller.detail({ projectId: project.id }),
    () => caller.rename({ projectId: project.id, name: 'Unauthorized' }),
    () => caller.removeMember({ projectId: project.id, memberId: 'any-member' }),
    () => caller.invite({ projectId: project.id, email: 'other@example.com', role: 'admin' }),
  ])
    await expect(action()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const instance = await account('instance@example.com');
  db.update(user).set({ role: 'admin' }).where(eq(user.id, instance.id)).run();
  const other = await auth.api.createOrganization({
    headers: instance.headers,
    body: { name: 'Other', slug: 'other' },
  });
  const otherMember = db.select().from(member).where(eq(member.organizationId, other!.id)).get()!;
  await expect(
    projectCaller(instance.headers).changeMemberRole({
      projectId: project.id,
      memberId: otherMember.id,
      role: 'viewer',
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(db.select().from(member).where(eq(member.id, otherMember.id)).get()!.role).toBe('admin');
  await expect(
    projectCaller(instance.headers).removeMember({
      projectId: project.id,
      memberId: otherMember.id,
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(db.select().from(member).where(eq(member.id, otherMember.id)).get()).toBeDefined();
});

test('accepted invitations leave the open list and preserve the inviter after account deletion', async () => {
  const invited = await invite();
  expect((await projectCaller().invitations({ projectId: project.id })).total).toBe(1);
  await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: invited.id } });
  expect((await projectCaller().invitations({ projectId: project.id })).total).toBe(0);
  const joined = (await projectCaller(recipient).detail({ projectId: project.id })).members.find(
    (m) => m.userId === recipientId,
  )!;
  expect(joined.invitedByName).toBe('admin@example.com');
  expect(joined.invitedById).toBeTruthy();
  db.delete(user).where(eq(user.id, joined.invitedById!)).run();
  const saved = (await projectCaller(recipient).detail({ projectId: project.id })).members[0];
  expect(saved.invitedById).toBeNull();
  expect(saved.invitedByName).toBe('admin@example.com');
});

test.each(['viewer', 'developer'] as const)('%s cannot remove project members', async (role) => {
  const invited = await invite(role);
  await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: invited.id } });
  const creator = db
    .select()
    .from(member)
    .where(eq(member.organizationId, project.id))
    .all()
    .find((m) => m.userId !== recipientId)!;
  await expect(
    projectCaller(recipient).removeMember({ projectId: project.id, memberId: creator.id }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(db.select().from(member).where(eq(member.id, creator.id)).get()).toBeDefined();
});

test('project admins remove members, revoke their access, and can invite them again', async () => {
  const invited = await invite('developer');
  await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: invited.id } });
  const joined = db.select().from(member).where(eq(member.userId, recipientId)).get()!;
  await projectCaller().removeMember({ projectId: project.id, memberId: joined.id });
  await expect(projectCaller(recipient).detail({ projectId: project.id })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  const reinvited = await projectCaller().invite({
    projectId: project.id,
    email: 'recipient@example.com',
    role: 'viewer',
  });
  await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: reinvited.id } });
  expect(
    (await projectCaller(recipient).detail({ projectId: project.id })).members.find(
      (m) => m.userId === recipientId,
    )?.role,
  ).toBe('viewer');
});
