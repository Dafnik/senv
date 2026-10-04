import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, ne } from 'drizzle-orm';
import { invitation, member, user } from '../../../../drizzle/schema';
import type { ProjectRole } from '../../shared/project-permissions';
import { db } from './db';
import { sendProjectInvitation } from './email';
import { invitationExpiresIn } from './project-options';

const recipientLocks = new Map<string, Promise<void>>();

export async function withProjectRecipientLock<T>(
  projectId: string,
  email: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  const key = `${projectId}\0${email}`;
  const previous = recipientLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  recipientLocks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (recipientLocks.get(key) === current) recipientLocks.delete(key);
  }
}

export async function createAndDeliverProjectInvitation(input: {
  projectId: string;
  email: string;
  role: ProjectRole;
  inviterId: string;
  inviterName: string;
  projectName: string;
}) {
  const existing = db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, input.projectId), eq(user.email, input.email)))
    .get();
  if (existing)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This account is already a project member.',
    });

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + invitationExpiresIn * 1000);
  const saved = db
    .insert(invitation)
    .values({
      id,
      organizationId: input.projectId,
      email: input.email,
      role: input.role,
      inviterId: input.inviterId,
      expiresAt,
    })
    .returning()
    .get()!;
  try {
    await sendProjectInvitation({
      invitationId: id,
      to: input.email,
      role: input.role,
      projectName: input.projectName,
      inviterName: input.inviterName,
      expiresAt,
    });
  } catch (error) {
    db.delete(invitation)
      .where(and(eq(invitation.id, id), eq(invitation.status, 'pending')))
      .run();
    console.error('Project invitation email delivery failed.', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The invitation email could not be sent. Please try again.',
    });
  }
  db.update(invitation)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(invitation.organizationId, input.projectId),
        eq(invitation.email, input.email),
        eq(invitation.status, 'pending'),
        ne(invitation.id, id),
      ),
    )
    .run();
  return saved;
}
