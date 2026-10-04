import { eq } from 'drizzle-orm';
import {
  deployment,
  deploymentSecret,
  deploymentLog,
  deploymentTag,
  deploymentBranchAlias,
} from '../../../../drizzle/schema';
import { db } from './db';
import { event } from './deployment-history';
import { isProtected } from './deployment-retention';

export type DeploymentRemovalAction = 'delete' | 'clean';

export function finishDeploymentRemoval(
  deploymentId: string,
  action: DeploymentRemovalAction,
  at: Date,
) {
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
