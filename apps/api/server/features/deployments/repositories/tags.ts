import { and, eq } from 'drizzle-orm';
import { deploymentTag } from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';

export function insertDeploymentTag(
  database: QueryHandle,
  values: typeof deploymentTag.$inferInsert,
) {
  return database.insert(deploymentTag).values(values).run();
}

export function findSelectedTag(tx: QueryHandle, deploymentId: string) {
  return tx
    .select({ id: deploymentTag.id })
    .from(deploymentTag)
    .where(eq(deploymentTag.deploymentId, deploymentId))
    .get();
}

export function findTagIdentity(projectId: string, candidate: string) {
  return db
    .select({ id: deploymentTag.id })
    .from(deploymentTag)
    .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, candidate)))
    .get();
}

export function findProjectTag(projectId: string, name: string) {
  return db
    .select()
    .from(deploymentTag)
    .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, name)))
    .get();
}

export function listPreviewTags() {
  return db.select().from(deploymentTag).all();
}

export function deleteDeploymentTagForDeployment(tx: QueryHandle, deploymentId: string) {
  return tx.delete(deploymentTag).where(eq(deploymentTag.deploymentId, deploymentId)).run();
}

export function deleteDeploymentTag(tx: QueryHandle, id: string) {
  return tx.delete(deploymentTag).where(eq(deploymentTag.id, id)).run();
}

export function deleteProjectTag(tx: QueryHandle, projectId: string, name: string) {
  return tx
    .delete(deploymentTag)
    .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, name)))
    .run();
}
