import { and, eq } from 'drizzle-orm';
import { deploymentRegistryCredential } from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';

export function updateRegistryCredential(
  database: QueryHandle,
  id: string,
  values: Partial<typeof deploymentRegistryCredential.$inferInsert>,
) {
  return database
    .update(deploymentRegistryCredential)
    .set(values)
    .where(eq(deploymentRegistryCredential.id, id))
    .run();
}

export function insertRegistryCredential(
  database: QueryHandle,
  values: typeof deploymentRegistryCredential.$inferInsert,
) {
  return database.insert(deploymentRegistryCredential).values(values).run();
}

export function findRegistryCredential(credentialId: string, projectId: string) {
  return db
    .select()
    .from(deploymentRegistryCredential)
    .where(
      and(
        eq(deploymentRegistryCredential.id, credentialId),
        eq(deploymentRegistryCredential.projectId, projectId),
      ),
    )
    .get();
}

export function listPublicRegistryCredentials(projectId: string) {
  return db
    .select({
      id: deploymentRegistryCredential.id,
      name: deploymentRegistryCredential.name,
      registry: deploymentRegistryCredential.registry,
      username: deploymentRegistryCredential.username,
      createdAt: deploymentRegistryCredential.createdAt,
    })
    .from(deploymentRegistryCredential)
    .where(eq(deploymentRegistryCredential.projectId, projectId))
    .all();
}

export function deleteProjectRegistryCredential(projectId: string, credentialId: string) {
  return db
    .delete(deploymentRegistryCredential)
    .where(
      and(
        eq(deploymentRegistryCredential.id, credentialId),
        eq(deploymentRegistryCredential.projectId, projectId),
      ),
    )
    .run();
}
