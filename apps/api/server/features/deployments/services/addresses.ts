import { TRPCError } from '@trpc/server';
import { customAlphabet } from 'nanoid';
import { deploymentTagNameSchema } from '../../../../shared/deployment-tags';
import { isValidPreviewHostname, type DeploymentActor } from '../../../../shared/deployments';
import { db } from '../../../infrastructure/db';
import { findProject } from '../../projects/repositories/projects';
import { findBranchAlias } from '../repositories/branches';
import {
  findDeployment,
  findDeploymentRetention,
  findDeploymentRetentionDates,
  updateDeployment,
} from '../repositories/deployments';
import {
  deleteDeploymentTag,
  deleteProjectTag,
  findProjectTag,
  insertDeploymentTag,
} from '../repositories/tags';
import { event } from './history';
import { updateRetention } from './retention';
import { refreshOrRollback, serializeRouteMutation } from './routing';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export function branchAlias(branch: string, projectId: string) {
  const clean =
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'branch';
  const label = clean.slice(0, 60).replace(/-+$/g, '');
  const alias = `br-${label}`;
  const collision = findBranchAlias(projectId, alias);
  if (collision && collision.branch !== branch)
    throw new TRPCError({
      code: 'CONFLICT',
      message: `Branch address ${alias} is already used by ${collision.branch}. Choose a different branch name.`,
    });
  return alias;
}

export async function assignDeploymentTag(
  projectId: string,
  name: string,
  deploymentId: string,
  actor?: DeploymentActor,
) {
  return serializeRouteMutation(async () => {
    if (!deploymentTagNameSchema.safeParse(name).success)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Tags must be lowercase DNS labels and cannot start with br-.',
      });
    if (findDeployment(name, projectId))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Tag names cannot match a deployment ID.',
      });
    const project = findProject(projectId);
    if (
      !project ||
      !isValidPreviewHostname(
        project.previewSlug,
        name,
        process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
      )
    )
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The tag hostname exceeds DNS limits or the configured preview domain is invalid.',
      });
    const target = findDeployment(deploymentId, projectId, db);
    if (
      !target ||
      target.cleanupStartedAt ||
      target.status !== 'healthy' ||
      target.desiredState !== 'running'
    )
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Tags can only select a healthy deployment that is not being removed.',
      });
    const prior = findProjectTag(projectId, name);
    const affectedIds = [
      ...new Set(
        [prior?.deploymentId, deploymentId].filter((value): value is string => Boolean(value)),
      ),
    ];
    const retention = affectedIds
      .map((value) => findDeploymentRetention(value))
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
    db.transaction((tx) => {
      if (prior) deleteDeploymentTag(tx, prior.id);
      insertDeploymentTag(tx, { id: id(), projectId, name, deploymentId });
      if (prior) updateRetention(tx, prior.deploymentId, true);
      updateRetention(tx, deploymentId, false);
    });
    await refreshOrRollback(() =>
      db.transaction((tx) => {
        deleteProjectTag(tx, projectId, name);
        if (prior) insertDeploymentTag(tx, prior);
        for (const value of retention)
          updateDeployment(tx, value.id, {
            retentionStartedAt: value.retentionStartedAt,
            retentionDeadlineAt: value.retentionDeadlineAt,
          });
      }),
    );
    event(db, projectId, deploymentId, 'tag-assigned', { name }, new Date(), actor);
    return { success: true };
  });
}
export async function removeDeploymentTag(
  projectId: string,
  name: string,
  actor?: DeploymentActor,
) {
  return serializeRouteMutation(async () => {
    const tag = findProjectTag(projectId, name);
    if (!tag) return { success: true };
    const priorDeployment = findDeploymentRetentionDates(tag.deploymentId);
    db.transaction((tx) => {
      deleteDeploymentTag(tx, tag.id);
      updateRetention(tx, tag.deploymentId, true);
    });
    await refreshOrRollback(() =>
      db.transaction((tx) => {
        insertDeploymentTag(tx, tag);
        if (priorDeployment) updateDeployment(tx, tag.deploymentId, priorDeployment);
      }),
    );
    event(db, projectId, tag.deploymentId, 'tag-removed', { name }, new Date(), actor);
    return { success: true };
  });
}

export { getPreviewRouteTargets } from './preview-addresses';
