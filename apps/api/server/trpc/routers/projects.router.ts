import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, asc, count, desc, eq, exists, gt, lt, or, sql } from 'drizzle-orm';
import * as z from 'zod';
import { invitation, member, organization, user } from '../../../../../drizzle/schema';
import { invitationSortFields } from '../../../shared/project-invitations';
import { db } from '../../utils/db';
import { auth } from '../../utils/auth';
import { sendProjectInvitation } from '../../utils/email';
import { invitationExpiresIn } from '../../utils/project-options';
import { projectRoleNames } from '../../../shared/project-permissions';
import { projectNameMaxLength } from '../../../shared/validation';
import { projectDeploymentSettings } from '../../../../../drizzle/schema';
import { customAlphabet } from 'nanoid';
import { suggestUniquePreviewSlug } from '../../utils/project-options';
import { assertProjectAccess } from '../../utils/project-access';
import { updateProjectPreviewSlug } from '../../utils/deployments';
import {
  deploymentSettingsSchema,
  projectRuntimeUpdateSchema,
  isValidPreviewHostname,
} from '../../../shared/deployments';
import {
  getProjectDeploymentSettings,
  getProjectRuntime,
  updateProjectRuntime,
  updateProjectDeploymentSettings,
} from '../../utils/project-deployment-settings';
import { authedProcedure, router } from '../trpc';

const projectInput = z.object({ projectId: z.string().min(1) });
const roleInput = z.enum(projectRoleNames);
const newProjectId = customAlphabet('acdefghjkmnpqrtuvwxy34679', 21);
function validatePreviewSlug(value: unknown, name: string) {
  const candidate = value === undefined ? suggestUniquePreviewSlug(name) : value;
  if (typeof candidate !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(candidate))
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Preview slugs must be lowercase DNS labels with letters, digits, and internal hyphens.',
    });
  let slug: string = candidate;
  if (
    value !== undefined &&
    db.select().from(organization).where(eq(organization.previewSlug, slug)).get()
  ) {
    throw new TRPCError({ code: 'CONFLICT', message: 'That preview slug is already in use.' });
  }
  if (
    !isValidPreviewHostname(
      slug,
      'a'.repeat(63),
      process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    )
  )
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'The configured preview domain leaves no room for valid deployment, branch, and tag labels.',
    });
  return slug;
}

function projectDetail(project: typeof organization.$inferSelect) {
  const members = db
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
    .where(eq(member.organizationId, project.id))
    .all();
  return { ...project, members };
}

export const projectsRouter = router({
  suggestPreviewSlug: authedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(projectNameMaxLength) }))
    .query(({ input }) => ({ previewSlug: suggestUniquePreviewSlug(input.name) })),
  create: authedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(projectNameMaxLength),
        previewSlug: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const projectId = newProjectId();
      const previewSlug = validatePreviewSlug(input.previewSlug, input.name);
      const created = db.transaction((tx) => {
        const project = tx
          .insert(organization)
          .values({ id: projectId, name: input.name, slug: projectId, previewSlug })
          .returning()
          .get()!;
        tx.insert(member)
          .values({
            id: randomUUID(),
            organizationId: projectId,
            userId: ctx.user.id,
            role: 'admin',
          })
          .run();
        const defaults = deploymentSettingsSchema.parse({});
        tx.insert(projectDeploymentSettings)
          .values({ projectId, ...defaults, repository: null })
          .run();
        return project;
      });
      return created;
    }),
  list: authedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(40),
        cursor: z.object({ createdAt: z.number().int().nonnegative(), id: z.string() }).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const rows = db
        .select({
          id: organization.id,
          name: organization.name,
          previewSlug: organization.previewSlug,
          createdAt: organization.createdAt,
        })
        .from(organization)
        .where(
          and(
            ctx.user.role === 'admin'
              ? undefined
              : exists(
                  db
                    .select({ id: member.id })
                    .from(member)
                    .where(
                      and(
                        eq(member.organizationId, organization.id),
                        eq(member.userId, ctx.user.id),
                      ),
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
      const hasNextPage = rows.length > input.limit;
      const projects = rows.slice(0, input.limit);
      const last = projects[projects.length - 1];
      return {
        projects,
        // Numeric timestamps survive Angular's SSR transfer cache without Date conversion.
        nextCursor:
          hasNextPage && last ? { createdAt: last.createdAt.getTime(), id: last.id } : null,
      };
    }),
  detail: authedProcedure.input(projectInput).query(({ ctx, input }) => {
    const project = assertProjectAccess(input.projectId, ctx.user);
    return projectDetail(project);
  }),
  bySlug: authedProcedure
    .input(z.object({ projectSlug: z.string().min(1).max(63) }))
    .query(({ ctx, input }) => {
      const project = db
        .select()
        .from(organization)
        .where(eq(organization.previewSlug, input.projectSlug))
        .get();
      if (!project)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found. Its slug may have changed.',
        });
      return projectDetail(assertProjectAccess(project.id, ctx.user));
    }),
  updatePreviewSlug: authedProcedure
    .input(projectInput.extend({ previewSlug: z.string().min(1).max(63) }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, false, true);
      return updateProjectPreviewSlug(input.projectId, input.previewSlug);
    }),
  runtime: authedProcedure.input(projectInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user);
    return getProjectRuntime(input.projectId);
  }),
  updateRuntime: authedProcedure
    .input(projectInput.extend({ runtime: projectRuntimeUpdateSchema }))
    .mutation(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, true);
      return updateProjectRuntime(input.projectId, input.runtime);
    }),
  deploymentSettings: authedProcedure.input(projectInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user);
    return {
      ...getProjectDeploymentSettings(input.projectId),
      baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    };
  }),
  updateDeploymentSettings: authedProcedure
    .input(projectInput.extend({ settings: deploymentSettingsSchema }))
    .mutation(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, true);
      const membership = db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, input.projectId), eq(member.userId, ctx.user.id)))
        .get();
      const previous = getProjectDeploymentSettings(input.projectId);
      const canChangeAdminOnly = ctx.user.role === 'admin' || membership?.role === 'admin';
      return updateProjectDeploymentSettings(
        input.projectId,
        canChangeAdminOnly
          ? input.settings
          : {
              ...input.settings,
              retentionDays: previous.retentionDays,
              originCpus: previous.originCpus,
              originMemoryBytes: previous.originMemoryBytes,
            },
      );
    }),
  rename: authedProcedure
    .input(projectInput.extend({ name: z.string().trim().min(1).max(projectNameMaxLength) }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, false, true);
      if (ctx.user.role !== 'admin')
        return auth.api.updateOrganization({
          headers: ctx.req.headers,
          body: { organizationId: input.projectId, data: { name: input.name } },
        });
      return db
        .update(organization)
        .set({ name: input.name })
        .where(eq(organization.id, input.projectId))
        .returning()
        .get();
    }),
  changeMemberRole: authedProcedure
    .input(projectInput.extend({ memberId: z.string().min(1), role: roleInput }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, false, true);
      if (ctx.user.role !== 'admin')
        return auth.api.updateMemberRole({
          headers: ctx.req.headers,
          body: { organizationId: input.projectId, memberId: input.memberId, role: input.role },
        });
      const updated = db
        .update(member)
        .set({ role: input.role })
        .where(and(eq(member.id, input.memberId), eq(member.organizationId, input.projectId)))
        .returning()
        .get();
      if (!updated)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this project.' });
      return updated;
    }),
  removeMember: authedProcedure
    .input(projectInput.extend({ memberId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, false, true);
      const target = db
        .select()
        .from(member)
        .where(and(eq(member.id, input.memberId), eq(member.organizationId, input.projectId)))
        .get();
      if (!target)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this project.' });
      if (ctx.user.role !== 'admin')
        return auth.api.removeMember({
          headers: ctx.req.headers,
          body: { organizationId: input.projectId, memberIdOrEmail: target.id },
        });
      db.delete(member)
        .where(and(eq(member.id, target.id), eq(member.organizationId, input.projectId)))
        .run();
      return { success: true };
    }),
  invite: authedProcedure
    .input(
      projectInput.extend({
        email: z.string().trim().toLowerCase().pipe(z.email()),
        role: roleInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = assertProjectAccess(input.projectId, ctx.user, false, true);
      if (ctx.user.role !== 'admin')
        return auth.api.createInvitation({
          headers: ctx.req.headers,
          body: { organizationId: input.projectId, email: input.email, role: input.role },
        });
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
      const saved = db.transaction((tx) => {
        tx.update(invitation)
          .set({ status: 'canceled' })
          .where(
            and(
              eq(invitation.organizationId, input.projectId),
              eq(invitation.email, input.email),
              eq(invitation.status, 'pending'),
            ),
          )
          .run();
        return tx
          .insert(invitation)
          .values({
            id,
            organizationId: input.projectId,
            email: input.email,
            role: input.role,
            inviterId: ctx.user.id,
            expiresAt,
          })
          .returning()
          .get()!;
      });
      try {
        await sendProjectInvitation({
          invitationId: id,
          to: input.email,
          role: input.role,
          projectName: project.name,
          inviterName: ctx.user.name,
          expiresAt,
        });
      } catch (error) {
        db.delete(invitation).where(eq(invitation.id, id)).run();
        console.error('Project invitation email delivery failed.', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'The invitation email could not be sent. Please try again.',
        });
      }
      return saved;
    }),
  cancelInvitation: authedProcedure
    .input(projectInput.extend({ invitationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, false, true);
      const saved = db
        .select()
        .from(invitation)
        .where(
          and(
            eq(invitation.id, input.invitationId),
            eq(invitation.organizationId, input.projectId),
          ),
        )
        .get();
      if (!saved) throw new TRPCError({ code: 'NOT_FOUND' });
      if (ctx.user.role !== 'admin')
        return auth.api.cancelInvitation({
          headers: ctx.req.headers,
          body: { invitationId: input.invitationId },
        });
      return db
        .update(invitation)
        .set({ status: 'canceled' })
        .where(eq(invitation.id, saved.id))
        .returning()
        .get();
    }),
  invitation: authedProcedure
    .input(z.object({ invitationId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      if (!ctx.user.emailVerified)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Verify your email address first.' });
      const saved = db
        .select({
          organizationName: organization.name,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
        })
        .from(invitation)
        .innerJoin(organization, eq(organization.id, invitation.organizationId))
        .where(
          and(
            eq(invitation.id, input.invitationId),
            eq(invitation.email, ctx.user.email.toLowerCase()),
            eq(invitation.status, 'pending'),
            gt(invitation.expiresAt, new Date()),
          ),
        )
        .get();
      if (!saved)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found or no longer open.',
        });
      return saved;
    }),
  invitations: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20),
        search: z.string().trim().max(254).default(''),
        sortBy: z.enum(invitationSortFields).default('createdAt'),
        sortDirection: z.enum(['asc', 'desc']).default('desc'),
      }),
    )
    .query(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, false, true);

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
    }),
});
