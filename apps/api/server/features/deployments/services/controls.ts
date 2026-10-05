import { TRPCError } from '@trpc/server';
import type { DeploymentActor } from '../../../../shared/deployments';
import { db } from '../../../infrastructure/db';
import { findDeployment, updateDeployment } from '../repositories/deployments';
import { event } from './history';
import { isProtected, updateRetention } from './retention';
import { refreshOrRollback, serializeRouteMutation } from './routing';
import { getProjectDeployment } from './summary';

export function setDeploymentPinned(
  projectId: string,
  deploymentId: string,
  pinned: boolean,
  actor?: DeploymentActor,
) {
  return db.transaction((tx) => {
    const row = findDeployment(deploymentId, projectId, tx);
    if (!row || row.deletedAt)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found.' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Deployment removal is already in progress.',
      });
    const previousProtected = isProtected(tx, deploymentId);
    updateDeployment(tx, deploymentId, { pinned });
    if (row.readyAt || row.status === 'failed' || row.retentionStartedAt)
      updateRetention(tx, deploymentId, previousProtected);
    event(tx, projectId, deploymentId, pinned ? 'pinned' : 'unpinned', {}, new Date(), actor);
    return getProjectDeployment(projectId, deploymentId);
  });
}

export async function requestDeploymentStart(deploymentId: string, actor?: DeploymentActor) {
  return serializeRouteMutation(async () => {
    const row = findDeployment(deploymentId, undefined, db);
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
    updateDeployment(db, deploymentId, {
      desiredState: 'running',
      status: 'queued',
      failureReason: null,
    });
    await refreshOrRollback(() =>
      updateDeployment(db, deploymentId, {
        desiredState: row.desiredState,
        status: row.status,
        failureReason: row.failureReason,
      }),
    );
    event(db, row.projectId, row.id, 'restart-requested', {}, new Date(), actor);
    return getProjectDeployment(row.projectId, row.id);
  });
}

export async function stopDeployment(deploymentId: string, actor?: DeploymentActor) {
  return serializeRouteMutation(async () => {
    const row = findDeployment(deploymentId, undefined, db);
    if (!row || row.deletedAt) throw new TRPCError({ code: 'NOT_FOUND' });
    if (row.cleanupStartedAt)
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'The deployment is being removed and cannot be stopped.',
      });
    updateDeployment(db, deploymentId, { desiredState: 'stopped', status: 'stopped' });
    await refreshOrRollback(() =>
      updateDeployment(db, deploymentId, {
        desiredState: row.desiredState,
        status: row.status,
        failureReason: row.failureReason,
      }),
    );
    event(db, row.projectId, row.id, 'stopped', {}, new Date(), actor);
    return getProjectDeployment(row.projectId, row.id);
  });
}
