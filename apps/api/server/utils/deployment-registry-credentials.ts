import { and, eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { deploymentRegistryCredential } from '../../../../drizzle/schema';
import { db } from './db';
import { encrypt, decrypt } from './deployment-secrets';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export function listRegistryCredentials(projectId: string) {
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
export function saveRegistryCredential(input: {
  projectId: string;
  id?: string;
  name: string;
  registry: string;
  username: string;
  secret: string;
}) {
  const saved = input.id
    ? db
        .select()
        .from(deploymentRegistryCredential)
        .where(
          and(
            eq(deploymentRegistryCredential.id, input.id),
            eq(deploymentRegistryCredential.projectId, input.projectId),
          ),
        )
        .get()
    : undefined;
  if (saved)
    db.update(deploymentRegistryCredential)
      .set({
        name: input.name,
        registry: input.registry,
        username: input.username,
        ciphertext: input.secret ? encrypt(input.secret) : saved.ciphertext,
        updatedAt: new Date(),
      })
      .where(eq(deploymentRegistryCredential.id, saved.id))
      .run();
  else
    db.insert(deploymentRegistryCredential)
      .values({
        id: id(),
        projectId: input.projectId,
        name: input.name,
        registry: input.registry,
        username: input.username,
        ciphertext: encrypt(input.secret),
      })
      .run();
  return listRegistryCredentials(input.projectId);
}
export function deleteRegistryCredential(projectId: string, credentialId: string) {
  db.delete(deploymentRegistryCredential)
    .where(
      and(
        eq(deploymentRegistryCredential.id, credentialId),
        eq(deploymentRegistryCredential.projectId, projectId),
      ),
    )
    .run();
  return { success: true };
}
export function getRegistrySecret(credentialId: string) {
  const credential = db
    .select()
    .from(deploymentRegistryCredential)
    .where(eq(deploymentRegistryCredential.id, credentialId))
    .get();
  return credential
    ? {
        registry: credential.registry,
        username: credential.username,
        secret: decrypt<string>(credential.ciphertext),
      }
    : null;
}
