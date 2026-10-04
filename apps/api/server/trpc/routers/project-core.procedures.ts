import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, exists, lt, or } from 'drizzle-orm';
import * as z from 'zod';
import { member, organization, user } from '../../../../../drizzle/schema';
import { db } from '../../utils/db';
import { previewSlugSchema, projectNameSchema } from '../../../shared/validation';
import { projectDeploymentSettings } from '../../../../../drizzle/schema';
import { customAlphabet } from 'nanoid';
import { suggestUniquePreviewSlug } from '../../utils/project-options';
import { assertProjectAccess } from '../../utils/project-access';
import { deploymentSettingsSchema, isValidPreviewHostname } from '../../../shared/deployments';
import { authedProcedure } from '../trpc';

const projectInput = z.object({ projectId: z.string().min(1) });
const newProjectId = customAlphabet('acdefghjkmnpqrtuvwxy34679', 21);
function validatePreviewSlug(value: unknown, name: string) {
  const candidate = value === undefined ? suggestUniquePreviewSlug(name) : value;
  const parsed = previewSlugSchema.safeParse(candidate);
  if (!parsed.success)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Preview slugs must be lowercase DNS labels with letters, digits, and internal hyphens.',
    });
  const slug = parsed.data;
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

export const projectCoreProcedures = {
  suggestPreviewSlug: authedProcedure
    .input(z.object({ name: projectNameSchema }))
    .query(({ input }) => ({ previewSlug: suggestUniquePreviewSlug(input.name) })),
  create: authedProcedure
    .input(
      z.object({
        name: projectNameSchema,
        previewSlug: previewSlugSchema.optional(),
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
    const project = assertProjectAccess(input.projectId, ctx.user, 'read');
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
      return projectDetail(assertProjectAccess(project.id, ctx.user, 'read'));
    }),
};
