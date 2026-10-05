import type { QueryHandle } from '../../../infrastructure/db';
import { findSelectedBranch } from '../repositories/branches';
import { findDeployment, findDeploymentPin, updateDeployment } from '../repositories/deployments';
import { findSelectedTag } from '../repositories/tags';

export type DeploymentQueryHandle = QueryHandle;

export function isProtected(tx: DeploymentQueryHandle, deploymentId: string) {
  return Boolean(
    findDeploymentPin(tx, deploymentId)?.pinned ||
    findSelectedBranch(tx, deploymentId) ||
    findSelectedTag(tx, deploymentId),
  );
}

export function updateRetention(
  tx: DeploymentQueryHandle,
  deploymentId: string,
  previousProtected: boolean,
  at = new Date(),
) {
  const row = findDeployment(deploymentId, undefined, tx);
  if (!row) return;
  const protectedNow = isProtected(tx, deploymentId);
  if (protectedNow) {
    updateDeployment(tx, deploymentId, { retentionStartedAt: null, retentionDeadlineAt: null });
  } else if (previousProtected || !row.retentionStartedAt) {
    const days = row.snapshot.retentionDays;
    updateDeployment(tx, deploymentId, {
      retentionStartedAt: at,
      retentionDeadlineAt: new Date(at.getTime() + days * 86400000),
    });
  }
}
