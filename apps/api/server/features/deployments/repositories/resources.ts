import { and, asc, eq, gt, lte } from 'drizzle-orm';
import { deploymentResourceSample } from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';

export function saveDeploymentResourceSample(values: typeof deploymentResourceSample.$inferInsert) {
  db.insert(deploymentResourceSample)
    .values(values)
    .onConflictDoUpdate({
      target: [deploymentResourceSample.deploymentId, deploymentResourceSample.sampledAt],
      set: values,
    })
    .run();
}

export function listDeploymentResourceSamples(deploymentId: string, from: Date, to: Date) {
  return db
    .select()
    .from(deploymentResourceSample)
    .where(
      and(
        eq(deploymentResourceSample.deploymentId, deploymentId),
        gt(deploymentResourceSample.sampledAt, from),
        lte(deploymentResourceSample.sampledAt, to),
      ),
    )
    .orderBy(asc(deploymentResourceSample.sampledAt))
    .all();
}

export function pruneResourceSamples(through: Date) {
  db.delete(deploymentResourceSample).where(lte(deploymentResourceSample.sampledAt, through)).run();
}

export function deleteDeploymentResourceSamples(database: QueryHandle, deploymentId: string) {
  database
    .delete(deploymentResourceSample)
    .where(eq(deploymentResourceSample.deploymentId, deploymentId))
    .run();
}
