import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';
import { invitation, user } from '../../../../drizzle/schema.ts';
import { account, db, email, project, projectCaller, recipient } from './projects.test-support.ts';

async function instanceAdminCaller() {
  const admin = await account('instance@example.com');
  db.update(user).set({ role: 'admin' }).where(eq(user.id, admin.id)).run();
  return projectCaller(admin.headers);
}

test('failed invitation replacement keeps the previously delivered invitation open', async () => {
  const admin = await instanceAdminCaller();
  const original = await admin.invite({
    projectId: project.id,
    email: 'recipient@example.com',
    role: 'viewer',
  });
  const send = vi.spyOn(email, 'sendProjectInvitation').mockRejectedValueOnce(new Error('offline'));
  try {
    await expect(
      admin.invite({
        projectId: project.id,
        email: 'recipient@example.com',
        role: 'developer',
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(db.select().from(invitation).where(eq(invitation.id, original.id)).get()?.status).toBe(
      'pending',
    );
    expect(await projectCaller(recipient).invitation({ invitationId: original.id })).toBeDefined();
    expect(
      db.select().from(invitation).where(eq(invitation.email, 'recipient@example.com')).all(),
    ).toHaveLength(1);
  } finally {
    send.mockRestore();
  }
});

test('serialized replacements wait for failed delivery before superseding the old invitation', async () => {
  const admin = await instanceAdminCaller();
  const original = await admin.invite({
    projectId: project.id,
    email: 'recipient@example.com',
    role: 'viewer',
  });
  let rejectFirst!: (error: Error) => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const blockedSend = new Promise<void>((_resolve, reject) => {
    rejectFirst = reject;
  });
  const send = vi.spyOn(email, 'sendProjectInvitation').mockImplementationOnce(async () => {
    markFirstStarted();
    await blockedSend;
  });
  try {
    const failed = admin.invite({
      projectId: project.id,
      email: 'recipient@example.com',
      role: 'developer',
    });
    await firstStarted;
    const succeeded = admin.invite({
      projectId: project.id,
      email: 'recipient@example.com',
      role: 'admin',
    });
    expect(send).toHaveBeenCalledTimes(1);
    rejectFirst(new Error('offline'));
    const results = await Promise.allSettled([failed, succeeded]);
    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('fulfilled');
    const open = db
      .select()
      .from(invitation)
      .where(eq(invitation.email, 'recipient@example.com'))
      .all()
      .filter((row) => row.status === 'pending');
    expect(open).toHaveLength(1);
    expect(open[0]?.role).toBe('admin');
    expect(db.select().from(invitation).where(eq(invitation.id, original.id)).get()?.status).toBe(
      'canceled',
    );
  } finally {
    send.mockRestore();
  }
});
