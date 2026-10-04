import { TRPCError } from '@trpc/server';
import * as z from 'zod';
import { invitationSortFields } from '../../../../shared/project-invitations';
import { projectRoleNames } from '../../../../shared/project-permissions';
import { emailAddressSchema } from '../../../../shared/validation';
import type { auth as authType } from '../../auth/auth';
import { auth } from '../../auth/auth';
import {
  cancelProjectInvitation,
  findOpenInvitation,
  findProjectInvitation,
  listOpenProjectInvitations,
} from '../repositories/invitations';
import { assertProjectAccess } from './access';
import { createAndDeliverProjectInvitation, withProjectRecipientLock } from './invitation-delivery';
type ProjectActor = typeof authType.$Infer.Session.user;

const projectInput = z.object({ projectId: z.string().min(1) });
const roleInput = z.enum(projectRoleNames);
export const inviteInputSchema = projectInput.extend({
  email: emailAddressSchema,
  role: roleInput,
});
export async function invite(
  actor: ProjectActor,
  headers: Headers,
  input: z.infer<typeof inviteInputSchema>,
) {
  return withProjectRecipientLock(input.projectId, input.email, async () => {
    const project = assertProjectAccess(input.projectId, actor, 'admin');
    if (actor.role !== 'admin')
      return auth.api.createInvitation({
        headers,
        body: { organizationId: input.projectId, email: input.email, role: input.role },
      });
    return createAndDeliverProjectInvitation({
      projectId: input.projectId,
      email: input.email,
      role: input.role,
      inviterId: actor.id,
      inviterName: actor.name,
      projectName: project.name,
    });
  });
}

export const cancelInvitationInputSchema = projectInput.extend({ invitationId: z.string().min(1) });
export async function cancelInvitation(
  actor: ProjectActor,
  headers: Headers,
  input: z.infer<typeof cancelInvitationInputSchema>,
) {
  assertProjectAccess(input.projectId, actor, 'admin');
  const saved = findProjectInvitation(input.projectId, input.invitationId);
  if (!saved) throw new TRPCError({ code: 'NOT_FOUND' });
  return withProjectRecipientLock(input.projectId, saved.email, () => {
    assertProjectAccess(input.projectId, actor, 'admin');
    return actor.role !== 'admin'
      ? auth.api.cancelInvitation({
          headers,
          body: { invitationId: input.invitationId },
        })
      : cancelProjectInvitation(saved.id);
  });
}

export const getInvitationInputSchema = z.object({ invitationId: z.string().min(1) });
export function getInvitation(
  actor: ProjectActor,
  input: z.infer<typeof getInvitationInputSchema>,
) {
  if (!actor.emailVerified)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Verify your email address first.' });
  const saved = findOpenInvitation(input.invitationId, actor.email.toLowerCase());
  if (!saved)
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Invitation not found or no longer open.',
    });
  return saved;
}

export const listInvitationsInputSchema = z.object({
  projectId: z.string(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(254).default(''),
  sortBy: z.enum(invitationSortFields).default('createdAt'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});
export function listInvitations(
  actor: ProjectActor,
  input: z.infer<typeof listInvitationsInputSchema>,
) {
  assertProjectAccess(input.projectId, actor, 'admin');

  return listOpenProjectInvitations(input);
}
