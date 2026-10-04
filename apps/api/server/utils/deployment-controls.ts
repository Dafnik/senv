import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { deployment } from '../../../../drizzle/schema';
import type { DeploymentActor } from '../../shared/deployments';
import { db } from './db';
import { event } from './deployment-history';
import { isProtected, updateRetention } from './deployment-retention';
import { refreshOrRollback, serializeRouteMutation } from './deployment-routing';
import { getProjectDeployment } from './deployment-summary';

export function setDeploymentPinned(
  projectId: string,
  deploymentId: string,
  pinned: boolean,
  actor?: DeploymentActor,
) {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(deployment)
      .where(and(eq(deployment.id, deploymentId), eq(deployment.projectId, projectId)))
      .get();
    if (!row || row.deletedAt)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found.' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Deployment removal is already in progress.',
      });
    const previousProtected = isProtected(tx, deploymentId);
    tx.update(deployment).set({ pinned }).where(eq(deployment.id, deploymentId)).run();
    if (row.readyAt || row.status === 'failed' || row.retentionStartedAt)
      updateRetention(tx, deploymentId, previousProtected);
    event(tx, projectId, deploymentId, pinned ? 'pinned' : 'unpinned', {}, new Date(), actor);
    return getProjectDeployment(projectId, deploymentId);
  });
}

export async function requestDeploymentStart(deploymentId: string, actor?: DeploymentActor) {
  return serializeRouteMutation(async () => {
    const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (!row || row.deletedAt) throw new TRPCError({ code: 'NOT_FOUND' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'The deployment is being removed and cannot be restarted.',
      });
    if (!row.artifactId && row.kind === 'static')
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'The deployment artifact is no longer retained.',
      });
    db.update(deployment)
      .set({ desiredState: 'running', status: 'queued', failureReason: null })
      .where(eq(deployment.id, deploymentId))
      .run();
    await refreshOrRollback(() =>
      db
        .update(deployment)
        .set({
          desiredState: row.desiredState,
          status: row.status,
          failureReason: row.failureReason,
        })
        .where(eq(deployment.id, deploymentId))
        .run(),
    );
    event(db, row.projectId, row.id, 'restart-requested', {}, new Date(), actor);
    return getProjectDeployment(row.projectId, row.id);
  });
}

export async function stopDeployment(deploymentId: string, actor?: DeploymentActor) {
  return serializeRouteMutation(async () => {
    const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (!row || row.deletedAt) throw new TRPCError({ code: 'NOT_FOUND' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'The deployment is being removed and cannot be stopped.',
      });
    db.update(deployment)
      .set({ desiredState: 'stopped', status: 'stopped' })
      .where(eq(deployment.id, deploymentId))
      .run();
    await refreshOrRollback(() =>
      db
        .update(deployment)
        .set({
          desiredState: row.desiredState,
          status: row.status,
          failureReason: row.failureReason,
        })
        .where(eq(deployment.id, deploymentId))
        .run(),
    );
    event(db, row.projectId, row.id, 'stopped', {}, new Date(), actor);
    return getProjectDeployment(row.projectId, row.id);
  });
}
