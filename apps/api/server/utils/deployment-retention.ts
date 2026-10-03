import { eq } from 'drizzle-orm';
import { deployment, deploymentBranchAlias, deploymentTag } from '../../../../drizzle/schema';
import { db } from './db';

type DeploymentTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DeploymentQueryHandle = typeof db | DeploymentTx;

export function isProtected(tx: DeploymentQueryHandle, deploymentId: string) {
  return Boolean(
    tx
      .select({ pinned: deployment.pinned })
      .from(deployment)
      .where(eq(deployment.id, deploymentId))
      .get()?.pinned ||
    tx
      .select({ id: deploymentBranchAlias.id })
      .from(deploymentBranchAlias)
      .where(eq(deploymentBranchAlias.deploymentId, deploymentId))
      .get() ||
    tx
      .select({ id: deploymentTag.id })
      .from(deploymentTag)
      .where(eq(deploymentTag.deploymentId, deploymentId))
      .get(),
  );
}

export function updateRetention(
  tx: DeploymentQueryHandle,
  deploymentId: string,
  previousProtected: boolean,
  at = new Date(),
) {
  const row = tx.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (!row) return;
  const protectedNow = isProtected(tx, deploymentId);
  if (protectedNow) {
    tx.update(deployment)
      .set({ retentionStartedAt: null, retentionDeadlineAt: null })
      .where(eq(deployment.id, deploymentId))
      .run();
  } else if (previousProtected || !row.retentionStartedAt) {
    const days = row.snapshot.retentionDays;
    tx.update(deployment)
      .set({
        retentionStartedAt: at,
        retentionDeadlineAt: new Date(at.getTime() + days * 86400000),
      })
      .where(eq(deployment.id, deploymentId))
      .run();
  }
}
