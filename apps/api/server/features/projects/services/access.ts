import { TRPCError } from '@trpc/server';
import { findAccount } from '../../auth/repositories/accounts';
import { findProject, findProjectMembership } from '../repositories/projects';

export type ProjectPermission = 'read' | 'manage' | 'admin';

export function assertProjectAccess(
  projectId: string,
  actor: { id: string; role?: string | null },
  permission: ProjectPermission = 'read',
) {
  const project = findProject(projectId);
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
  if (actor.role === 'admin') return project;
  const membership = findProjectMembership(projectId, actor.id);
  if (
    !membership ||
    (permission === 'admin' && membership.role !== 'admin') ||
    (permission === 'manage' && membership.role === 'viewer')
  ) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return project;
}
export function assertCanPublishProject(userId: string, projectId: string) {
  const actor = findAccount(userId);
  if (!actor) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return assertProjectAccess(projectId, actor, 'manage');
}
