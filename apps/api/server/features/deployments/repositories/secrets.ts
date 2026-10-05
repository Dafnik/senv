import { eq } from 'drizzle-orm';
import { deploymentSecret } from '../../../../../../drizzle/schema';
import { type QueryHandle } from '../../../infrastructure/db';

export function insertDeploymentSecrets(
  database: QueryHandle,
  values: typeof deploymentSecret.$inferInsert,
) {
  return database.insert(deploymentSecret).values(values).run();
}

export function deleteDeploymentSecretsForDeployment(tx: QueryHandle, deploymentId: string) {
  return tx.delete(deploymentSecret).where(eq(deploymentSecret.deploymentId, deploymentId)).run();
}
