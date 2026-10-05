import { TRPCError } from '@trpc/server';
import { deployment } from '../../../../../../drizzle/schema';
import type { DeploymentActor } from '../../../../shared/deployments';
import { db } from '../../../infrastructure/db';
import {
  findDeployment,
  findDueDeployment,
  listDueDeployments,
  listPendingRemovals,
  updateDeployment,
} from '../repositories/deployments';
import { finishDeploymentRemoval, type DeploymentRemovalAction } from './removal-finalize';
import { isProtected } from './retention';
import { refreshPreviewRoutes, serializeRouteMutation } from './routing';

let deploymentRemovalHandler:
  | ((deploymentId: string, projectId: string) => Promise<void>)
  | undefined;
export function registerDeploymentRemovalHandler(
  callback?: (deploymentId: string, projectId: string) => Promise<void>,
) {
  deploymentRemovalHandler = callback;
}

function clearRemovalIntent(deploymentId: string) {
  updateDeployment(db, deploymentId, {
    cleanupStartedAt: null,
    cleanupAction: null,
    cleanupActor: null,
  });
}

/** Called under the route mutation lock by deletion, retention cleanup, and recovery. */
async function completeRemoval(
  row: typeof deployment.$inferSelect,
  action: DeploymentRemovalAction,
  at: Date,
  actor?: DeploymentActor,
): Promise<boolean> {
  const removeResources = deploymentRemovalHandler;
  if (!removeResources)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Deployment runtime removal is not available yet.',
    });
  const beganIntent = !row.cleanupStartedAt;
  if (beganIntent)
    updateDeployment(db, row.id, {
      cleanupStartedAt: at,
      cleanupAction: action,
      cleanupActor: action === 'delete' && actor ? { id: actor.id, name: actor.name } : null,
    });
  try {
    await refreshPreviewRoutes();
  } catch (error) {
    if (beganIntent) {
      clearRemovalIntent(row.id);
      await refreshPreviewRoutes().catch((restoreError) => {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            'Route retirement failed and the deployment was preserved, but its previous preview route could not be confirmed.',
          cause: restoreError,
        });
      });
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message:
        'Preview route retirement failed; deployment removal remains pending when previously started.',
      cause: error,
    });
  }
  try {
    await removeResources(row.id, row.projectId);
  } catch (error) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message:
        'Runtime removal failed; removal intent and deployment records were preserved for retry.',
      cause: error,
    });
  }
  return finishDeploymentRemoval(row.id, action, at);
}

export async function deleteDeployment(deploymentId: string, actor?: DeploymentActor) {
  return serializeRouteMutation(async () => {
    const row = findDeployment(deploymentId, undefined, db);
    if (!row || row.deletedAt) throw new TRPCError({ code: 'NOT_FOUND' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'A deployment removal is already pending.',
      });
    if (!(await completeRemoval(row, 'delete', new Date(), actor)))
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'The deployment removal intent changed before deletion completed.',
      });
    await refreshPreviewRoutes();
    return { success: true };
  });
}

export async function cleanupDueDeployments(now = new Date()) {
  const due = listDueDeployments(now);
  let cleaned = 0;
  let firstError: unknown;
  for (const candidate of due) {
    try {
      const didClean = await serializeRouteMutation(async () => {
        const row = findDueDeployment(candidate.id, now);
        if (!row || row.cleanupStartedAt || isProtected(db, row.id)) return false;
        return completeRemoval(row, 'clean', now);
      });
      if (didClean) cleaned++;
    } catch (error) {
      firstError ??= error;
      console.error(`[deployment-removal] cleanup failed for deployment ${candidate.id}`, error);
    }
  }
  if (firstError) throw firstError;
  return cleaned;
}

/** Retries durable removals left pending if the API stopped before finalizing their records. */
export async function resumePendingDeploymentRemovals() {
  const pending = listPendingRemovals();
  let completed = 0;
  let firstError: unknown;
  for (const item of pending) {
    try {
      const didComplete = await serializeRouteMutation(async () => {
        const row = findDeployment(item.id, undefined, db);
        if (!row?.cleanupStartedAt) return false;
        const action = row.cleanupAction;
        if (!action) throw new Error(`Pending removal ${row.id} has no action.`);
        if (action === 'clean' && isProtected(db, row.id)) {
          clearRemovalIntent(row.id);
          await refreshPreviewRoutes();
          return false;
        }
        return completeRemoval(row, action, new Date());
      });
      if (didComplete) completed++;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
  return completed;
}
