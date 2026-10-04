import { eq } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { invitation, member, user } from '../../../drizzle/schema';
import {
  account,
  admin,
  auth,
  db,
  email,
  invite,
  outsider,
  project,
  recipient,
  recipientId,
  request,
} from './projects.test-support';

test('renders the email locally and only the recipient can accept the single-use link', async () => {
  const invited = await invite('developer');
  const message = email.getEmailNotifications()[0];
  expect(message.to).toBe('recipient@example.com');
  expect(message.html).toContain(`/invitations/${invited.id}`);
  expect(message.text).toContain('Test project');
  expect(message.text).toContain('developer');
  expect(invited.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.99 * 86400000);
  expect((await request('accept-invitation', outsider, { invitationId: invited.id })).status).toBe(
    403,
  );
  await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: invited.id } });
  expect(db.select().from(member).where(eq(member.userId, recipientId)).get()?.role).toBe(
    'developer',
  );
  expect((await request('accept-invitation', recipient, { invitationId: invited.id })).ok).toBe(
    false,
  );
});

test('expired, cancelled and replaced links cannot be accepted', async () => {
  const expired = await invite();
  db.update(invitation)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(invitation.id, expired.id))
    .run();
  expect((await request('accept-invitation', recipient, { invitationId: expired.id })).ok).toBe(
    false,
  );
  const replaced = await invite();
  const current = await invite('admin');
  expect((await request('accept-invitation', recipient, { invitationId: replaced.id })).ok).toBe(
    false,
  );
  await auth.api.cancelInvitation({ headers: admin, body: { invitationId: current.id } });
  expect((await request('accept-invitation', recipient, { invitationId: current.id })).ok).toBe(
    false,
  );
  expect(db.select().from(member).all()).toHaveLength(1);
});

test('visible invitation IDs cannot bypass recipient verification; the emailed verification link enables acceptance', async () => {
  const viewerInvite = await invite('viewer');
  await auth.api.acceptInvitation({ headers: recipient, body: { invitationId: viewerInvite.id } });
  const invited = await auth.api.createInvitation({
    headers: admin,
    body: { email: 'new-recipient@example.com', role: 'admin', organizationId: project.id },
  });
  const visible = await auth.api.getFullOrganization({
    headers: recipient,
    query: { organizationId: project.id },
  });
  expect(visible?.invitations.some((i) => i.id === invited.id)).toBe(true);
  const unverified = await account('new-recipient@example.com', false);
  expect((await request(`get-invitation?id=${invited.id}`, unverified.headers)).status).toBe(403);
  for (const path of ['accept-invitation', 'reject-invitation']) {
    expect((await request(path, unverified.headers, { invitationId: invited.id })).status).toBe(
      403,
    );
  }
  expect(db.select().from(member).where(eq(member.userId, unverified.id)).get()).toBeUndefined();
  const callbackURL = `http://localhost:4200/invitations/${invited.id}`;
  await auth.api.sendVerificationEmail({
    headers: unverified.headers,
    body: { email: 'new-recipient@example.com', callbackURL },
  });
  const message = email.getEmailNotifications()[0];
  expect(message.to).toBe('new-recipient@example.com');
  expect(message.subject).toBe('Verify your email address');
  const link = message.html
    .match(/href="([^"]*\/verify-email\?[^"]*)"/)![1]
    .replaceAll('&amp;', '&');
  const verified = await auth.handler(new Request(link));
  expect(verified.status).toBe(302);
  expect(verified.headers.get('location')).toBe(callbackURL);
  expect(db.select().from(user).where(eq(user.id, unverified.id)).get()?.emailVerified).toBe(true);
  expect((await request(`get-invitation?id=${invited.id}`, unverified.headers)).status).toBe(200);
  expect(
    (await request('accept-invitation', unverified.headers, { invitationId: invited.id })).status,
  ).toBe(200);
  expect(db.select().from(member).where(eq(member.userId, unverified.id)).get()?.role).toBe(
    'admin',
  );
});
