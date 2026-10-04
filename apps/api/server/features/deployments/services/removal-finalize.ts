import { deleteDeploymentResourceSamples } from '../repositories/resources';
import { db } from '../../../infrastructure/db';
import { clearDeploymentBranches } from '../repositories/branches';
import { findDeployment, updateDeployment } from '../repositories/deployments';
import { deleteDeploymentLogForDeployment } from '../repositories/logs';
import { deleteDeploymentSecretsForDeployment } from '../repositories/secrets';
import { deleteDeploymentTagForDeployment } from '../repositories/tags';
import { event } from './history';
import { isProtected } from './retention';

export type DeploymentRemovalAction = 'delete' | 'clean';

export function finishDeploymentRemoval(
  deploymentId: string,
  action: DeploymentRemovalAction,
  at: Date,
) {
  return db.transaction((tx) => {
    const row = findDeployment(deploymentId, undefined, tx);
    if (!row || !row.cleanupStartedAt || (action === 'clean' && isProtected(tx, deploymentId)))
      return false;
    deleteDeploymentSecretsForDeployment(tx, deploymentId);
    deleteDeploymentLogForDeployment(tx, deploymentId);
    deleteDeploymentResourceSamples(tx, deploymentId);
    deleteDeploymentTagForDeployment(tx, deploymentId);
    clearDeploymentBranches(tx, deploymentId);
    updateDeployment(tx, deploymentId, {
      status: action === 'delete' ? 'deleted' : 'cleaned',
      desiredState: 'stopped',
      artifactId: null,
      retentionDeadlineAt: null,
      cleanupStartedAt: null,
      cleanupAction: null,
      cleanupActor: null,
      deletedAt: at,
    });
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
