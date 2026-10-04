import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { customAlphabet } from 'nanoid';
import { deploymentRegistryCredential } from '../../../../drizzle/schema';
import { db } from './db';
import { encrypt } from './deployment-secrets';

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
  if (!input.id && !input.secret)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Enter the registry access token or password.',
    });
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
  if (input.id && !saved)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Registry credential not found.' });
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
