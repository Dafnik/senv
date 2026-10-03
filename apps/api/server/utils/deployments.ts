import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { deployment, deploymentBranchAlias } from '../../../../drizzle/schema';
import type { DeploymentActor } from '../../shared/deployments';
import { db } from './db';
import { event } from './deployment-history';
import { isProtected, updateRetention } from './deployment-retention';
import {
  refreshPreviewRoutes,
  refreshOrRollback,
  serializeRouteMutation,
} from './deployment-routing';
import { getProjectDeployment } from './deployment-summary';
import { getDeploymentRuntimeConfig } from './deployment-runtime-config';
import { branchAlias } from './deployment-addresses';

export { assertProjectAccess, assertCanPublishProject } from './project-access';
export {
  getProjectDeploymentSettings,
  updateProjectDeploymentSettings,
  getProjectRuntime,
  updateProjectRuntime,
  getInstanceDeploymentDefaults,
  updateInstanceDeploymentDefaults,
} from './project-deployment-settings';
export {
  listRegistryCredentials,
  saveRegistryCredential,
  deleteRegistryCredential,
} from './deployment-registry-credentials';
export { getDeploymentLogs, appendDeploymentLog } from './deployment-logs';

export { registerPreviewRoutesRefresh } from './deployment-routing';
export { listProjectDeployments, getProjectDeployment } from './deployment-summary';
export { listDeploymentHistory, removeDeploymentHistory } from './deployment-history';
export {
  registerUploadedArtifact,
  getArtifact,
  listReferencedArtifactStorageKeys,
  getArtifactCleanupState,
  forgetArtifactStorageKey,
} from './deployment-artifacts';
export { publishDeployment } from './deployment-publication';
export {
  assignDeploymentTag,
  removeDeploymentTag,
  getPreviewRouteTargets,
  updateProjectPreviewSlug,
} from './deployment-addresses';
export {
  registerDeploymentRemovalHandler,
  deleteDeployment,
  cleanupDueDeployments,
  resumePendingDeploymentRemovals,
} from './deployment-removal';
export {
  getDeploymentRuntimeConfig,
  listDeploymentRuntimeConfigs,
  setDeploymentImageDigest,
} from './deployment-runtime-config';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

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

export async function markDeploymentReady(deploymentId: string, at = new Date()) {
  db.transaction((tx) => {
    const row = tx.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (!row || row.deletedAt) return;
    if (
      row.cleanupStartedAt ||
      row.desiredState !== 'running' ||
      !['queued', 'starting', 'healthy', 'unhealthy'].includes(row.status)
    )
      return;
    tx.update(deployment)
      .set({ status: 'healthy', readyAt: at, failureReason: null })
      .where(eq(deployment.id, deploymentId))
      .run();
    event(tx, row.projectId, row.id, 'healthy', {}, at);
    const branch = row.source?.branch;
    if (branch) {
      const current = tx
        .select()
        .from(deploymentBranchAlias)
        .where(
          and(
            eq(deploymentBranchAlias.projectId, row.projectId),
            eq(deploymentBranchAlias.branch, branch),
          ),
        )
        .get();
      if (!current || row.submissionOrder >= current.selectionOrder) {
        const lostProtection = current?.deploymentId
          ? isProtected(tx, current.deploymentId)
          : false;
        if (current)
          tx.update(deploymentBranchAlias)
            .set({ deploymentId: row.id, selectionOrder: row.submissionOrder, updatedAt: at })
            .where(eq(deploymentBranchAlias.id, current.id))
            .run();
        else
          tx.insert(deploymentBranchAlias)
            .values({
              id: id(),
              projectId: row.projectId,
              branch,
              alias: branchAlias(branch, row.projectId),
              deploymentId: row.id,
              selectionOrder: row.submissionOrder,
            })
            .onConflictDoUpdate({
              target: [deploymentBranchAlias.projectId, deploymentBranchAlias.branch],
              set: { deploymentId: row.id, selectionOrder: row.submissionOrder, updatedAt: at },
            })
            .run();
        if (current?.deploymentId) updateRetention(tx, current.deploymentId, lostProtection, at);
      }
    }
    updateRetention(tx, row.id, false, at);
  });
  await refreshPreviewRoutes();
}
export async function markDeploymentFailed(deploymentId: string, reason: string, at = new Date()) {
  const safeReason = reason.slice(0, 4000);
  db.transaction((tx) => {
    const row = tx.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
    if (
      !row ||
      row.deletedAt ||
      row.cleanupStartedAt ||
      row.desiredState !== 'running' ||
      !['queued', 'starting'].includes(row.status)
    )
      return;
    tx.update(deployment)
      .set({ status: 'failed', failureReason: safeReason })
      .where(eq(deployment.id, deploymentId))
      .run();
    event(tx, row.projectId, row.id, 'failed', { reason: safeReason }, at);
    updateRetention(tx, row.id, false, at);
  });
}
export function markDeploymentStarting(deploymentId: string, at = new Date()) {
  const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (
    !row ||
    row.deletedAt ||
    row.cleanupStartedAt ||
    row.desiredState !== 'running' ||
    !['queued', 'starting', 'healthy', 'unhealthy'].includes(row.status)
  )
    return null;
  if (row.status !== 'starting') {
    db.update(deployment).set({ status: 'starting' }).where(eq(deployment.id, deploymentId)).run();
    event(db, row.projectId, row.id, 'starting', {}, at);
  }
  return getDeploymentRuntimeConfig(deploymentId);
}
export async function setDeploymentHealth(
  deploymentId: string,
  status: 'healthy' | 'unhealthy',
  reason?: string,
  at = new Date(),
) {
  const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (
    !row ||
    row.deletedAt ||
    row.cleanupStartedAt ||
    row.desiredState !== 'running' ||
    !['healthy', 'unhealthy'].includes(row.status)
  )
    return;
  db.update(deployment)
    .set({ status, failureReason: reason?.slice(0, 4000) ?? null })
    .where(eq(deployment.id, deploymentId))
    .run();
  event(
    db,
    row.projectId,
    deploymentId,
    status,
    reason ? { reason: reason.slice(0, 4000) } : {},
    at,
  );
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
