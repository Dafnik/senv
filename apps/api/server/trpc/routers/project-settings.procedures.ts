import { and, eq } from 'drizzle-orm';
import * as z from 'zod';
import { member } from '../../../../../drizzle/schema';
import { projectRuntimeUpdateSchema, deploymentSettingsSchema } from '../../../shared/deployments';
import { previewSlugSchema } from '../../../shared/validation';
import { db } from '../../utils/db';
import { assertProjectAccess } from '../../utils/project-access';
import { updateProjectPreviewSlug } from '../../utils/deployments';
import {
  getProjectDeploymentSettings,
  getProjectRuntime,
  updateProjectRuntime,
  updateProjectDeploymentSettings,
} from '../../utils/project-deployment-settings';
import { authedProcedure } from '../trpc';

const projectInput = z.object({ projectId: z.string().min(1) });

export const projectSettingsProcedures = {
  updatePreviewSlug: authedProcedure
    .input(projectInput.extend({ previewSlug: previewSlugSchema }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'admin');
      return updateProjectPreviewSlug(input.projectId, input.previewSlug);
    }),
  runtime: authedProcedure.input(projectInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'read');
    return getProjectRuntime(input.projectId);
  }),
  updateRuntime: authedProcedure
    .input(projectInput.extend({ runtime: projectRuntimeUpdateSchema }))
    .mutation(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'manage');
      return updateProjectRuntime(input.projectId, input.runtime);
    }),
  deploymentSettings: authedProcedure.input(projectInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'read');
    return {
      ...getProjectDeploymentSettings(input.projectId),
      baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    };
  }),
  updateDeploymentSettings: authedProcedure
    .input(projectInput.extend({ settings: deploymentSettingsSchema }))
    .mutation(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'manage');
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
};
