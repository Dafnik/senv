import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import {
  deployment,
  deploymentSecret,
  deploymentLog,
  deploymentTag,
  deploymentBranchAlias,
} from '../../../../drizzle/schema';
import type { DeploymentActor } from '../../shared/deployments';
import { db } from './db';
import { event } from './deployment-history';
import { isProtected } from './deployment-retention';
import { refreshPreviewRoutes, serializeRouteMutation } from './deployment-routing';

type DeploymentRemovalAction = 'delete' | 'clean';
let deploymentRemovalHandler: ((deploymentId: string) => Promise<void>) | undefined;
export function registerDeploymentRemovalHandler(
  callback?: (deploymentId: string) => Promise<void>,
) {
  deploymentRemovalHandler = callback;
}

function finishDeploymentRemoval(deploymentId: string, action: DeploymentRemovalAction, at: Date) {
  return db.transaction((tx) => {
    const row = tx.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (!row || !row.cleanupStartedAt || (action === 'clean' && isProtected(tx, deploymentId)))
      return false;
    tx.delete(deploymentSecret).where(eq(deploymentSecret.deploymentId, deploymentId)).run();
    tx.delete(deploymentLog).where(eq(deploymentLog.deploymentId, deploymentId)).run();
    tx.delete(deploymentTag).where(eq(deploymentTag.deploymentId, deploymentId)).run();
    tx.update(deploymentBranchAlias)
      .set({ deploymentId: null })
      .where(eq(deploymentBranchAlias.deploymentId, deploymentId))
      .run();
    tx.update(deployment)
      .set({
        status: action === 'delete' ? 'deleted' : 'cleaned',
        desiredState: 'stopped',
        artifactId: null,
        retentionDeadlineAt: null,
        cleanupStartedAt: null,
        cleanupAction: null,
        cleanupActor: null,
        deletedAt: at,
      })
      .where(eq(deployment.id, deploymentId))
      .run();
    event(
      tx,
      row.projectId,
      deploymentId,
      action === 'delete' ? 'deleted' : 'cleaned',
      {},
      at,
      action === 'delete' ? (row.cleanupActor ?? undefined) : undefined,
    );
    return true;
  });
}

function clearRemovalIntent(deploymentId: string) {
  db.update(deployment)
    .set({ cleanupStartedAt: null, cleanupAction: null, cleanupActor: null })
    .where(eq(deployment.id, deploymentId))
    .run();
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
  if (!row.cleanupStartedAt)
    db.update(deployment)
      .set({
        cleanupStartedAt: at,
        cleanupAction: action,
        cleanupActor: action === 'delete' && actor ? { id: actor.id, name: actor.name } : null,
      })
      .where(eq(deployment.id, row.id))
      .run();
  try {
    await refreshPreviewRoutes();
    await removeResources(row.id);
  } catch (error) {
    clearRemovalIntent(row.id);
    try {
      await refreshPreviewRoutes();
    } catch (restoreError) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'Runtime removal failed and the deployment was preserved, but its previous preview route could not be confirmed.',
        cause: restoreError,
      });
    }
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Runtime removal failed; secrets, artifacts, and history were preserved.',
      cause: error,
    });
  }
  return finishDeploymentRemoval(row.id, action, at);
}

export async function deleteDeployment(deploymentId: string, actor?: DeploymentActor) {
  return serializeRouteMutation(async () => {
    const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
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
  const due = db
    .select()
    .from(deployment)
    .where(
      and(
        isNull(deployment.deletedAt),
        isNotNull(deployment.retentionDeadlineAt),
        lte(deployment.retentionDeadlineAt, now),
      ),
    )
    .all();
  let cleaned = 0;
  for (const candidate of due) {
    const didClean = await serializeRouteMutation(async () => {
      const row = db
        .select()
        .from(deployment)
        .where(
          and(
            eq(deployment.id, candidate.id),
            isNull(deployment.deletedAt),
            isNotNull(deployment.retentionDeadlineAt),
            lte(deployment.retentionDeadlineAt, now),
          ),
        )
        .get();
      if (!row || row.cleanupStartedAt || isProtected(db, row.id)) return false;
      return completeRemoval(row, 'clean', now);
    });
    if (didClean) cleaned++;
  }
  return cleaned;
}

/** Retries durable removals left pending if the API stopped before finalizing their records. */
export async function resumePendingDeploymentRemovals() {
  const pending = db
    .select({ id: deployment.id })
    .from(deployment)
    .where(isNotNull(deployment.cleanupStartedAt))
    .orderBy(asc(deployment.submittedAt), asc(deployment.id))
    .all();
  let completed = 0;
  let firstError: unknown;
  for (const item of pending) {
    try {
      const didComplete = await serializeRouteMutation(async () => {
        const row = db.select().from(deployment).where(eq(deployment.id, item.id)).get();
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
