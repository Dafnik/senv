import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { member, organization, user } from '../../../../drizzle/schema';
import { db } from './db';

export function assertProjectAccess(
  projectId: string,
  actor: { id: string; role?: string | null },
  manage = false,
  adminOnly = false,
) {
  const project = db.select().from(organization).where(eq(organization.id, projectId)).get();
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
  if (actor.role === 'admin') return project;
  const membership = db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, projectId), eq(member.userId, actor.id)))
    .get();
  if (
    !membership ||
    (adminOnly && membership.role !== 'admin') ||
    (manage && membership.role === 'viewer')
  ) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return project;
}
export function assertCanPublishProject(userId: string, projectId: string) {
  const actor = db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  if (!actor) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return assertProjectAccess(projectId, actor, true);
}
