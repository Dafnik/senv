import { customAlphabet } from 'nanoid';
import { db } from '../../../infrastructure/db';
import {
  findProjectBranch,
  updateBranchAlias,
  upsertBranchSelection,
} from '../repositories/branches';
import { findDeployment, updateDeployment } from '../repositories/deployments';
import { branchAlias } from './addresses';
import { event } from './history';
import { isProtected, updateRetention } from './retention';
import { refreshPreviewRoutes } from './routing';
import { getDeploymentRuntimeConfig } from './runtime-config';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export async function markDeploymentReady(deploymentId: string, at = new Date()) {
  db.transaction((tx) => {
    const row = findDeployment(deploymentId, undefined, tx);
    if (!row || row.deletedAt) return;
    if (
      row.cleanupStartedAt ||
      row.desiredState !== 'running' ||
      !['queued', 'starting', 'healthy', 'unhealthy'].includes(row.status)
    )
      return;
    updateDeployment(tx, deploymentId, { status: 'healthy', readyAt: at, failureReason: null });
    event(tx, row.projectId, row.id, 'healthy', {}, at);
    const branch = row.source?.branch;
    if (branch) {
      const current = findProjectBranch(tx, row.projectId, branch);
      if (!current || row.submissionOrder >= current.selectionOrder) {
        const lostProtection = current?.deploymentId
          ? isProtected(tx, current.deploymentId)
          : false;
        if (current)
          updateBranchAlias(tx, current.id, {
            deploymentId: row.id,
            selectionOrder: row.submissionOrder,
            updatedAt: at,
          });
        else
          upsertBranchSelection(
            tx,
            {
              id: id(),
              projectId: row.projectId,
              branch,
              alias: branchAlias(branch, row.projectId),
              deploymentId: row.id,
              selectionOrder: row.submissionOrder,
            },
            at,
          );
        if (current?.deploymentId) updateRetention(tx, current.deploymentId, lostProtection, at);
      }
    }
    updateRetention(tx, row.id, false, at);
  });
  await refreshPreviewRoutes();
}

export async function markDeploymentFailed(
  deploymentId: string,
  reason: string,
  at = new Date(),
  options: { stopRuntime?: boolean } = {},
) {
  const safeReason = reason.slice(0, 4000);
  db.transaction((tx) => {
    const row = findDeployment(deploymentId, undefined, tx);
    if (
      !row ||
      row.deletedAt ||
      row.cleanupStartedAt ||
      row.desiredState !== 'running' ||
      (!['queued', 'starting'].includes(row.status) && !options.stopRuntime)
    )
      return;
    updateDeployment(tx, deploymentId, {
      status: 'failed',
      failureReason: safeReason,
      ...(options.stopRuntime ? { desiredState: 'stopped' as const } : {}),
    });
    event(tx, row.projectId, row.id, 'failed', { reason: safeReason }, at);
    updateRetention(tx, row.id, false, at);
  });
}

export function markDeploymentStarting(deploymentId: string, at = new Date()) {
  const row = findDeployment(deploymentId, undefined, db);
  if (
    !row ||
    row.deletedAt ||
    row.cleanupStartedAt ||
    row.desiredState !== 'running' ||
    !['queued', 'starting', 'healthy', 'unhealthy'].includes(row.status)
  )
    return null;
  if (row.status !== 'starting') {
    updateDeployment(db, deploymentId, { status: 'starting' });
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
  const row = findDeployment(deploymentId, undefined, db);
  if (
    !row ||
    row.deletedAt ||
    row.cleanupStartedAt ||
    row.desiredState !== 'running' ||
    !['healthy', 'unhealthy'].includes(row.status)
  )
    return;
  updateDeployment(db, deploymentId, { status, failureReason: reason?.slice(0, 4000) ?? null });
  event(
    db,
    row.projectId,
    deploymentId,
    status,
    reason ? { reason: reason.slice(0, 4000) } : {},
    at,
  );
}
