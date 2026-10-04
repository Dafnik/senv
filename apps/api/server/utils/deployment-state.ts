import { and, eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { deployment, deploymentBranchAlias } from '../../../../drizzle/schema';
import { db } from './db';
import { event } from './deployment-history';
import { isProtected, updateRetention } from './deployment-retention';
import { refreshPreviewRoutes } from './deployment-routing';
import { getDeploymentRuntimeConfig } from './deployment-runtime-config';
import { branchAlias } from './deployment-addresses';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

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
