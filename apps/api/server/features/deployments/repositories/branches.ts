import { and, eq } from 'drizzle-orm';
import { deploymentBranchAlias } from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';

export function updateBranchAlias(
  database: QueryHandle,
  id: string,
  values: Partial<typeof deploymentBranchAlias.$inferInsert>,
) {
  return database
    .update(deploymentBranchAlias)
    .set(values)
    .where(eq(deploymentBranchAlias.id, id))
    .run();
}

export function findSelectedBranch(tx: QueryHandle, deploymentId: string) {
  return tx
    .select({ id: deploymentBranchAlias.id })
    .from(deploymentBranchAlias)
    .where(eq(deploymentBranchAlias.deploymentId, deploymentId))
    .get();
}

export function findProjectBranch(tx: QueryHandle, projectId: string, branch: string) {
  return tx
    .select()
    .from(deploymentBranchAlias)
    .where(
      and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.branch, branch)),
    )
    .get();
}

export function findBranchAlias(projectId: string, alias: string) {
  return db
    .select()
    .from(deploymentBranchAlias)
    .where(
      and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.alias, alias)),
    )
    .get();
}

export function listPreviewBranches() {
  return db
    .select({
      branchAlias: deploymentBranchAlias.alias,
      projectId: deploymentBranchAlias.projectId,
      deploymentId: deploymentBranchAlias.deploymentId,
    })
    .from(deploymentBranchAlias)
    .all();
}

export function upsertBranchSelection(
  tx: QueryHandle,
  values: typeof deploymentBranchAlias.$inferInsert,
  at: Date,
) {
  return tx
    .insert(deploymentBranchAlias)
    .values(values)
    .onConflictDoUpdate({
      target: [deploymentBranchAlias.projectId, deploymentBranchAlias.branch],
      set: {
        deploymentId: values.deploymentId,
        selectionOrder: values.selectionOrder,
        updatedAt: at,
      },
    })
    .run();
}

export function initializeBranchAlias(
  tx: QueryHandle,
  values: typeof deploymentBranchAlias.$inferInsert,
) {
  return tx.insert(deploymentBranchAlias).values(values).onConflictDoNothing().run();
}

export function clearDeploymentBranches(tx: QueryHandle, deploymentId: string) {
  return tx
    .update(deploymentBranchAlias)
    .set({ deploymentId: null })
    .where(eq(deploymentBranchAlias.deploymentId, deploymentId))
    .run();
}
