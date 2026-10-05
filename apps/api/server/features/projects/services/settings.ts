import * as z from 'zod';
import {
  deploymentSettingsSchema,
  projectRuntimeUpdateSchema,
} from '../../../../shared/deployments';
import { previewSlugSchema } from '../../../../shared/validation';
import type { auth as authType } from '../../auth/auth';
import { findProjectMembership } from '../repositories/projects';
import { assertProjectAccess } from './access';
import {
  getProjectDeploymentSettings,
  getProjectRuntime,
  updateProjectDeploymentSettings,
  updateProjectRuntime,
} from './deployment-settings';
import { updateProjectPreviewSlug } from './preview-slug';
type ProjectActor = typeof authType.$Infer.Session.user;

const projectInput = z.object({ projectId: z.string().min(1) });

export const changePreviewSlugInputSchema = projectInput.extend({ previewSlug: previewSlugSchema });
export async function changePreviewSlug(
  actor: ProjectActor,
  input: z.infer<typeof changePreviewSlugInputSchema>,
) {
  assertProjectAccess(input.projectId, actor, 'admin');
  return updateProjectPreviewSlug(input.projectId, input.previewSlug);
}

export const getRuntimeInputSchema = projectInput;
export function getRuntime(actor: ProjectActor, input: z.infer<typeof getRuntimeInputSchema>) {
  assertProjectAccess(input.projectId, actor, 'read');
  return getProjectRuntime(input.projectId);
}

export const saveRuntimeInputSchema = projectInput.extend({ runtime: projectRuntimeUpdateSchema });
export function saveRuntime(actor: ProjectActor, input: z.infer<typeof saveRuntimeInputSchema>) {
  assertProjectAccess(input.projectId, actor, 'manage');
  return updateProjectRuntime(input.projectId, input.runtime);
}

export const getDeploymentSettingsInputSchema = projectInput;
export function getDeploymentSettings(
  actor: ProjectActor,
  input: z.infer<typeof getDeploymentSettingsInputSchema>,
) {
  assertProjectAccess(input.projectId, actor, 'read');
  return {
    ...getProjectDeploymentSettings(input.projectId),
    baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
  };
}

export const saveDeploymentSettingsInputSchema = projectInput.extend({
  settings: deploymentSettingsSchema,
});
export function saveDeploymentSettings(
  actor: ProjectActor,
  input: z.infer<typeof saveDeploymentSettingsInputSchema>,
) {
  assertProjectAccess(input.projectId, actor, 'manage');
  const membership = findProjectMembership(input.projectId, actor.id);
  const previous = getProjectDeploymentSettings(input.projectId);
  const canChangeAdminOnly = actor.role === 'admin' || membership?.role === 'admin';
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
}
