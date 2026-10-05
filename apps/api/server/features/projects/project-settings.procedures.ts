import { authedProcedure } from '../../trpc/trpc';
import {
  changePreviewSlug,
  changePreviewSlugInputSchema,
  getDeploymentSettings,
  getDeploymentSettingsInputSchema,
  getRuntime,
  getRuntimeInputSchema,
  saveDeploymentSettings,
  saveDeploymentSettingsInputSchema,
  saveRuntime,
  saveRuntimeInputSchema,
} from './services/settings';

export const projectSettingsProcedures = {
  updatePreviewSlug: authedProcedure
    .input(changePreviewSlugInputSchema)
    .mutation(({ ctx, input }) => changePreviewSlug(ctx.user, input)),
  runtime: authedProcedure
    .input(getRuntimeInputSchema)
    .query(({ ctx, input }) => getRuntime(ctx.user, input)),
  updateRuntime: authedProcedure
    .input(saveRuntimeInputSchema)
    .mutation(({ ctx, input }) => saveRuntime(ctx.user, input)),
  deploymentSettings: authedProcedure
    .input(getDeploymentSettingsInputSchema)
    .query(({ ctx, input }) => getDeploymentSettings(ctx.user, input)),
  updateDeploymentSettings: authedProcedure
    .input(saveDeploymentSettingsInputSchema)
    .mutation(({ ctx, input }) => saveDeploymentSettings(ctx.user, input)),
};
