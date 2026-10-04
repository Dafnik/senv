import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import type { ProjectRole } from '../../../../shared/project-permissions';
import { sendProjectInvitation } from '../../notifications/services/email';
import { invitationExpiresIn } from '../auth-options';
import {
  cancelOtherProjectInvitations,
  deletePendingProjectInvitation,
  insertProjectInvitation,
} from '../repositories/invitations';
import { findProjectMemberByEmail } from '../repositories/projects';

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
  const existing = findProjectMemberByEmail(input.projectId, input.email);
  if (existing)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This account is already a project member.',
    });

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + invitationExpiresIn * 1000);
  const saved = insertProjectInvitation({
    id,
    organizationId: input.projectId,
    email: input.email,
    role: input.role,
    inviterId: input.inviterId,
    expiresAt,
  });
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
    deletePendingProjectInvitation(id);
    console.error('Project invitation email delivery failed.', error);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'The invitation email could not be sent. Please try again.',
    });
  }
  cancelOtherProjectInvitations(input.projectId, input.email, id);
  return saved;
}
