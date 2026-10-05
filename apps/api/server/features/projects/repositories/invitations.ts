import { and, asc, count, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { invitation, organization, user } from '../../../../../../drizzle/schema';
import type { invitationSortFields } from '../../../../shared/project-invitations';
import { db } from '../../../infrastructure/db';
export interface InvitationListQuery {
  projectId: string;
  offset: number;
  limit: number;
  search: string;
  sortBy: (typeof invitationSortFields)[number];
  sortDirection: 'asc' | 'desc';
}
export function findProjectInvitation(projectId: string, invitationId: string) {
  return db
    .select()
    .from(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, projectId)))
    .get();
}
export function cancelProjectInvitation(invitationId: string) {
  return db
    .update(invitation)
    .set({ status: 'canceled' })
    .where(eq(invitation.id, invitationId))
    .returning()
    .get();
}
export function findOpenInvitation(invitationId: string, email: string) {
  return db
    .select({
      organizationName: organization.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(
      and(
        eq(invitation.id, invitationId),
        eq(invitation.email, email),
        eq(invitation.status, 'pending'),
        gt(invitation.expiresAt, new Date()),
      ),
    )
    .get();
}
export function insertProjectInvitation(values: typeof invitation.$inferInsert) {
  return db.insert(invitation).values(values).returning().get()!;
}
export function deletePendingProjectInvitation(invitationId: string) {
  db.delete(invitation)
    .where(and(eq(invitation.id, invitationId), eq(invitation.status, 'pending')))
    .run();
}
export function cancelOtherProjectInvitations(
  projectId: string,
  email: string,
  invitationId: string,
) {
  db.update(invitation)
    .set({ status: 'canceled' })
    .where(
      and(
        eq(invitation.organizationId, projectId),
        eq(invitation.email, email),
        eq(invitation.status, 'pending'),
        ne(invitation.id, invitationId),
      ),
    )
    .run();
}
export function listOpenProjectInvitations(input: InvitationListQuery) {
  const filter = and(
    eq(invitation.organizationId, input.projectId),
    input.search
      ? sql`instr(lower(${invitation.email}), ${input.search.toLowerCase()}) > 0`
      : undefined,
    eq(invitation.status, 'pending'),
    gt(invitation.expiresAt, new Date()),
  );
  const sortColumn = input.sortBy === 'invitedByName' ? user.name : invitation[input.sortBy];
  const invitations = db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      invitedById: invitation.inviterId,
      invitedByName: user.name,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    })
    .from(invitation)
    .innerJoin(user, eq(user.id, invitation.inviterId))
    .where(filter)
    .orderBy(
      input.sortDirection === 'asc' ? asc(sortColumn) : desc(sortColumn),
      desc(invitation.id),
    )
    .limit(input.limit)
    .offset(input.offset)
    .all();
  const total = db.select({ total: count() }).from(invitation).where(filter).get()!.total;
  return { invitations, total };
}
