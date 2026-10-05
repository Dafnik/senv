import { closeShells } from '../../deployments/services/shell-registry';
import { and, desc, eq, exists, lt, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { member, organization, user } from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';

export type Project = typeof organization.$inferSelect;
export interface ProjectListQuery {
  limit: number;
  cursor?: { createdAt: number; id: string };
}
export function findProject(projectId: string, database: QueryHandle = db) {
  return database.select().from(organization).where(eq(organization.id, projectId)).get();
}
export function findProjectByPreviewSlug(slug: string, exceptProjectId?: string) {
  return db
    .select()
    .from(organization)
    .where(
      and(
        eq(organization.previewSlug, slug),
        exceptProjectId ? ne(organization.id, exceptProjectId) : undefined,
      ),
    )
    .get();
}
export function findProjectMembership(projectId: string, userId: string) {
  return db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, projectId), eq(member.userId, userId)))
    .get();
}
export function findProjectMember(projectId: string, memberId: string) {
  return db
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, projectId)))
    .get();
}
export function findProjectMemberByEmail(projectId: string, email: string) {
  return db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, projectId), eq(user.email, email)))
    .get();
}
export function listProjectMembers(projectId: string) {
  return db
    .select({
      id: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      invitedById: member.invitedById,
      invitedByName: member.invitedByName,
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, projectId))
    .all();
}
export function insertProject(
  database: QueryHandle,
  input: { id: string; name: string; previewSlug: string },
) {
  return database
    .insert(organization)
    .values({ ...input, slug: input.id })
    .returning()
    .get()!;
}
export function insertProjectAdmin(database: QueryHandle, projectId: string, userId: string) {
  database
    .insert(member)
    .values({ id: randomUUID(), organizationId: projectId, userId, role: 'admin' })
    .run();
}
export function listVisibleProjects(
  actor: { id: string; role?: string | null },
  input: ProjectListQuery,
) {
  return db
    .select({
      id: organization.id,
      name: organization.name,
      previewSlug: organization.previewSlug,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .where(
      and(
        actor.role === 'admin'
          ? undefined
          : exists(
              db
                .select({ id: member.id })
                .from(member)
                .where(
                  and(eq(member.organizationId, organization.id), eq(member.userId, actor.id)),
                ),
            ),
        input.cursor
          ? or(
              lt(organization.createdAt, new Date(input.cursor.createdAt)),
              and(
                eq(organization.createdAt, new Date(input.cursor.createdAt)),
                lt(organization.id, input.cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(organization.createdAt), desc(organization.id))
    .limit(input.limit + 1)
    .all();
}
export function renameProject(projectId: string, name: string) {
  return db
    .update(organization)
    .set({ name })
    .where(eq(organization.id, projectId))
    .returning()
    .get();
}
export function changeProjectMemberRole(projectId: string, memberId: string, role: string) {
  const target = findProjectMember(projectId, memberId);
  if (target) void closeShells({ userId: target.userId, projectId }, 'permission_lost');
  return db
    .update(member)
    .set({ role })
    .where(and(eq(member.id, memberId), eq(member.organizationId, projectId)))
    .returning()
    .get();
}
export function deleteProjectMember(projectId: string, memberId: string) {
  const target = findProjectMember(projectId, memberId);
  if (target) void closeShells({ userId: target.userId, projectId }, 'permission_lost');
  db.delete(member)
    .where(and(eq(member.id, memberId), eq(member.organizationId, projectId)))
    .run();
}
export function recordProjectMemberInviter(
  memberId: string,
  inviter?: { id: string; name: string },
) {
  db.update(member)
    .set({ invitedById: inviter?.id ?? null, invitedByName: inviter?.name ?? null })
    .where(eq(member.id, memberId))
    .run();
}
export function saveProjectPreviewSlug(projectId: string, slug: string) {
  return db
    .update(organization)
    .set({ previewSlug: slug })
    .where(eq(organization.id, projectId))
    .returning()
    .get();
}
export function restoreProjectPreviewSlug(projectId: string, previous: string, current: string) {
  db.update(organization)
    .set({ previewSlug: previous })
    .where(and(eq(organization.id, projectId), eq(organization.previewSlug, current)))
    .run();
}

export function listProjectPreviewSlugs() {
  return db
    .select({ id: organization.id, projectSlug: organization.previewSlug })
    .from(organization)
    .all();
}
