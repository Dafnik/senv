import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vite-plus/test';
import { invitation, member, organization, user } from '../../../drizzle/schema';

let auth: typeof import('./utils/auth').auth;
let db: typeof import('./utils/db').db;
let email: typeof import('./utils/email');
let notificationsResponse: typeof import('./api/notifications.get').notificationsResponse;
let appRouter: typeof import('./trpc/routers').appRouter;
const directory = mkdtempSync(join(tmpdir(), 'senv-projects-'));
let admin: Headers;
let recipient: Headers;
let outsider: Headers;
let recipientId: string;
let project: { id: string; name: string; slug: string };

beforeAll(async () => {
  vi.stubEnv('DATABASE_URL', `file:${join(directory, 'projects.sqlite')}`);
  vi.stubEnv('BETTER_AUTH_SECRET', 'projects-test-secret-at-least-32-characters');
  vi.stubEnv('ROOT_DOMAIN', 'localhost');
  vi.stubEnv('API_URL', 'http://localhost:3000');
  vi.stubEnv('APP_URL', 'http://localhost:4200');
  vi.stubEnv('NODE_ENV', 'development');
  ({ db } = await import('./utils/db'));
  migrate(db, { migrationsFolder: 'drizzle/migrations' });
  ({ auth } = await import('./utils/auth'));
  ({ appRouter } = await import('./trpc/routers'));
  email = await import('./utils/email');
  ({ notificationsResponse } = await import('./api/notifications.get'));
});

async function account(address: string, verified = true) {
  const created = await auth.api.createUser({
    body: {
      name: address,
      email: address,
      password: 'projects-test-password',
      data: { emailVerified: verified },
    },
  });
  const response = await auth.api.signInEmail({
    body: { email: address, password: 'projects-test-password' },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  return {
    id: created.user.id,
    headers: new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; '),
    }),
  };
}

beforeEach(async () => {
  db.delete(organization).run();
  db.delete(user).run();
  email.clearEmailNotifications();
  admin = (await account('admin@example.com')).headers;
  const invited = await account('recipient@example.com');
  recipient = invited.headers;
  recipientId = invited.id;
  outsider = (await account('outsider@example.com')).headers;
  project = (await auth.api.createOrganization({
    headers: admin,
    body: { name: '  Test project  ', slug: 'client-slug-is-ignored' },
  }))!;
});

afterAll(() => {
  db?.$client.close();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

async function invite(role: 'viewer' | 'developer' | 'admin' = 'viewer') {
  return auth.api.createInvitation({
    headers: admin,
    body: {
      email: 'recipient@example.com',
      role,
      organizationId: project.id,
    },
  });
}

async function request(path: string, headers = new Headers(), body?: unknown) {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('origin', 'http://localhost:4200');
  if (body) requestHeaders.set('content-type', 'application/json');
  return auth.handler(
    new Request(`http://localhost:3000/api/auth/organization/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: requestHeaders,
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

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
  expect((await notificationsResponse().json()).notifications).toHaveLength(1);
  expect(notificationsResponse().headers.get('cache-control')).toBe('no-store');
  vi.stubEnv('NODE_ENV', 'production');
  try {
    expect(notificationsResponse().status).toBe(404);
  } finally {
    vi.stubEnv('NODE_ENV', 'development');
  }
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

function projectCaller(headers: Headers = admin) {
  return appRouter.createCaller({ req: new Request('http://localhost:3000/api/trpc', { headers }) })
    .projects;
}

test('cursor pagination returns every membership beyond 100 with stable ordering and no outsider access', async () => {
  const creator = db.select().from(member).where(eq(member.organizationId, project.id)).get()!;
  for (let i = 0; i < 105; i++) {
    const id = `paged-project-${String(i).padStart(3, '0')}`;
    db.insert(organization)
      .values({ id, slug: id, name: id, createdAt: new Date(1000) })
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
  const pending = await caller.invitations({ projectId: project.id, status: 'pending' });
  expect(pending.total).toBe(1);
  expect(pending.invitations[0].id).toBe(current.id);
  const all = await caller.invitations({ projectId: project.id, offset: 100 });
  expect(all.total).toBe(102);
  expect(all.invitations).toHaveLength(2);
  const cancelled = await request('cancel-invitation', admin, {
    invitationId: pending.invitations[0].id,
  });
  expect(cancelled.status).toBe(200);
  expect((await caller.invitations({ projectId: project.id, status: 'pending' })).total).toBe(0);
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
    (await caller.invitations({ projectId: project.id, status: 'expired' })).invitations.map(
      (i) => i.id,
    ),
  ).toEqual([expired.id]);
  const result = await caller.invitations({
    projectId: project.id,
    search: 'ZEBRA',
    status: 'pending',
  });
  expect(result.total).toBe(1);
  expect(result.invitations[0].id).toBe(next.id);
  expect(
    (
      await caller.invitations({ projectId: project.id, sortBy: 'email', sortDirection: 'asc' })
    ).invitations.map((i) => i.email),
  ).toEqual(['recipient@example.com', 'zebra@example.com']);
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
