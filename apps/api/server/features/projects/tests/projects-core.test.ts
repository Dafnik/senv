import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';
import { member, organization } from '../../../../../../drizzle/schema.ts';
import {
  admin,
  auth,
  db,
  invite,
  notificationResponse,
  notificationsResponse,
  outsider,
  project,
  recipient,
  recipientId,
  request,
} from './projects.test-support.ts';

test('creates a named project with an immutable lowercase Nano ID and an admin', async () => {
  expect(project.name).toBe('Test project');
  expect(project.id).toMatch(/^[acdefghjkmnpqrtuvwxy34679]{21}$/);
  expect(project.slug).toBe(project.id);
  expect(db.select().from(member).get()?.role).toBe('admin');
  expect((await auth.api.listOrganizations({ headers: admin })).map((p) => p.id)).toEqual([
    project.id,
  ]);
  expect(await auth.api.listOrganizations({ headers: outsider })).toEqual([]);
  const updated = await auth.api.updateOrganization({
    headers: admin,
    body: {
      organizationId: project.id,
      data: { name: 'Renamed project' },
    },
  });
  expect(updated?.name).toBe('Renamed project');
  expect(updated?.id).toBe(project.id);
  expect(
    (await request('update', admin, { organizationId: project.id, data: { slug: 'new-id' } }))
      .status,
  ).toBe(400);
  expect((await request('create', admin, { name: '   ', slug: 'empty' })).status).toBe(400);
  expect(
    (await request('create', new Headers(), { name: 'Unauthorized', slug: 'unauthorized' })).status,
  ).toBe(401);
});

test.each(['viewer', 'developer'] as const)(
  '%s can read their project but cannot mutate it or invite users',
  async (role) => {
    const invitation = await invite(role);
    await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: invitation.id } });
    expect(
      (
        await auth.api.getFullOrganization({
          headers: recipient,
          query: { organizationId: project.id },
        })
      )?.id,
    ).toBe(project.id);
    for (const [path, body] of [
      ['update', { organizationId: project.id, data: { name: 'Forbidden' } }],
      ['delete', { organizationId: project.id }],
      ['invite-member', { organizationId: project.id, email: 'new@example.com', role: 'viewer' }],
      [
        'update-member-role',
        {
          organizationId: project.id,
          memberId: db.select().from(member).where(eq(member.userId, recipientId)).get()!.id,
          role: 'admin',
        },
      ],
    ] as const) {
      expect((await request(path, recipient, body)).ok).toBe(false);
    }
    expect((await request(`get-full-organization?organizationId=${project.id}`, outsider)).ok).toBe(
      false,
    );
    expect(db.select().from(organization).get()?.name).toBe('Test project');
  },
);

test('invited admins can rename and invite, but the last admin cannot leave or be demoted', async () => {
  const adminMember = db.select().from(member).get()!;
  expect(
    (
      await request('update-member-role', admin, {
        organizationId: project.id,
        memberId: adminMember.id,
        role: 'viewer',
      })
    ).ok,
  ).toBe(false);
  expect((await request('leave', admin, { organizationId: project.id })).ok).toBe(false);
  const invited = await invite('admin');
  await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: invited.id } });
  expect(
    (
      await request('update', recipient, {
        organizationId: project.id,
        data: { name: 'Shared project' },
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await request('invite-member', recipient, {
        organizationId: project.id,
        email: 'next@example.com',
        role: 'viewer',
      })
    ).ok,
  ).toBe(true);
  expect(
    (
      await request('invite-member', admin, {
        organizationId: project.id,
        email: 'bad@example.com',
        role: ['viewer', 'developer'],
      })
    ).ok,
  ).toBe(false);
});

test('the temporary notifications endpoint is disabled outside development', async () => {
  await invite();
  const { notifications } = await notificationsResponse().json();
  expect(notifications).toHaveLength(1);
  expect(notifications[0].previewUrl).toBe(
    `http://localhost:3000/notification/${notifications[0].id}`,
  );
  expect(await notificationResponse(notifications[0].id).text()).toBe(notifications[0].html);
  expect(notificationsResponse().headers.get('cache-control')).toBe('no-store');
  vi.stubEnv('NODE_ENV', 'production');
  try {
    expect(notificationsResponse().status).toBe(404);
  } finally {
    vi.stubEnv('NODE_ENV', 'development');
  }
});
