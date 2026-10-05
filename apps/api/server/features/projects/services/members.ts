import { TRPCError } from '@trpc/server';
import * as z from 'zod';
import { projectRoleNames } from '../../../../shared/project-permissions';
import { projectNameSchema } from '../../../../shared/validation';
import type { auth as authType } from '../../auth/auth';
import { auth } from '../../auth/auth';
import {
  changeProjectMemberRole,
  deleteProjectMember,
  findProjectMember,
  renameProject,
} from '../repositories/projects';
import { assertProjectAccess } from './access';
type ProjectActor = typeof authType.$Infer.Session.user;

const projectInput = z.object({ projectId: z.string().min(1) });
const roleInput = z.enum(projectRoleNames);

export const renameInputSchema = projectInput.extend({ name: projectNameSchema });
export async function rename(
  actor: ProjectActor,
  headers: Headers,
  input: z.infer<typeof renameInputSchema>,
) {
  assertProjectAccess(input.projectId, actor, 'admin');
  if (actor.role !== 'admin')
    return auth.api.updateOrganization({
      headers,
      body: { organizationId: input.projectId, data: { name: input.name } },
    });
  return renameProject(input.projectId, input.name);
}

export const changeMemberRoleInputSchema = projectInput.extend({
  memberId: z.string().min(1),
  role: roleInput,
});
export async function changeMemberRole(
  actor: ProjectActor,
  headers: Headers,
  input: z.infer<typeof changeMemberRoleInputSchema>,
) {
  assertProjectAccess(input.projectId, actor, 'admin');
  if (actor.role !== 'admin')
    return auth.api.updateMemberRole({
      headers,
      body: { organizationId: input.projectId, memberId: input.memberId, role: input.role },
    });
  const updated = changeProjectMemberRole(input.projectId, input.memberId, input.role);
  if (!updated)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this project.' });
  return updated;
}

export const removeMemberInputSchema = projectInput.extend({ memberId: z.string().min(1) });
export async function removeMember(
  actor: ProjectActor,
  headers: Headers,
  input: z.infer<typeof removeMemberInputSchema>,
) {
  assertProjectAccess(input.projectId, actor, 'admin');
  const target = findProjectMember(input.projectId, input.memberId);
  if (!target)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this project.' });
  if (actor.role !== 'admin')
    return auth.api.removeMember({
      headers,
      body: { organizationId: input.projectId, memberIdOrEmail: target.id },
    });
  deleteProjectMember(input.projectId, target.id);
  return { success: true };
}
