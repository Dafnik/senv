import * as z from 'zod';
import { previewSlugSchema, projectNameSchema } from '../../../shared/validation';
import { authedProcedure } from '../../trpc/trpc';
import { suggestUniquePreviewSlug } from './auth-options';
import { createProject, getProject, getProjectBySlug, listProjects } from './services/projects';

export const projectCoreProcedures = {
  suggestPreviewSlug: authedProcedure
    .input(z.object({ name: projectNameSchema }))
    .query(({ input }) => ({ previewSlug: suggestUniquePreviewSlug(input.name) })),
  create: authedProcedure
    .input(z.object({ name: projectNameSchema, previewSlug: previewSlugSchema.optional() }))
    .mutation(({ ctx, input }) => createProject(ctx.user, input)),
  list: authedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(40),
        cursor: z.object({ createdAt: z.number().int().nonnegative(), id: z.string() }).optional(),
      }),
    )
    .query(({ ctx, input }) => listProjects(ctx.user, input)),
  detail: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(({ ctx, input }) => getProject(ctx.user, input.projectId)),
  bySlug: authedProcedure
    .input(z.object({ projectSlug: z.string().min(1).max(63) }))
    .query(({ ctx, input }) => getProjectBySlug(ctx.user, input.projectSlug)),
};
