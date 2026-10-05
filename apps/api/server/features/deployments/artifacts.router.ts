import * as z from 'zod';
import { authedProcedure, router } from '../../trpc/trpc';
import { assertProjectAccess } from '../projects/services/access';
import {
  projectArtifact,
  projectArtifactDirectory,
  projectArtifactFile,
  projectArtifacts,
} from './services/artifact-browser';

const projectInput = z.object({ projectId: z.string().min(1) });
const artifactInput = projectInput.extend({ artifactId: z.string().min(1) });

export const artifactsRouter = router({
  list: authedProcedure
    .input(
      projectInput.extend({
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().nonnegative().default(0),
      }),
    )
    .query(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'read');
      return projectArtifacts(input.projectId, input.limit, input.offset);
    }),
  detail: authedProcedure.input(artifactInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'read');
    return projectArtifact(input.projectId, input.artifactId);
  }),
  file: authedProcedure
    .input(artifactInput.extend({ path: z.string().min(1).max(4096) }))
    .query(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'read');
      return projectArtifactFile(input.projectId, input.artifactId, input.path);
    }),
  directory: authedProcedure
    .input(
      artifactInput.extend({
        path: z.string().max(4096).default(''),
      }),
    )
    .query(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'read');
      return projectArtifactDirectory(input.projectId, input.artifactId, input.path);
    }),
});
