import { TRPCError } from '@trpc/server';
import { customAlphabet } from 'nanoid';
import { db } from '../../../infrastructure/db';
import { encrypt } from '../domain/secrets';
import {
  deleteProjectRegistryCredential,
  findRegistryCredential,
  insertRegistryCredential,
  listPublicRegistryCredentials,
  updateRegistryCredential,
} from '../repositories/registry-credentials';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export function listRegistryCredentials(projectId: string) {
  return listPublicRegistryCredentials(projectId);
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
  const saved = input.id ? findRegistryCredential(input.id, input.projectId) : undefined;
  if (input.id && !saved)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Registry credential not found.' });
  if (saved)
    updateRegistryCredential(db, saved.id, {
      name: input.name,
      registry: input.registry,
      username: input.username,
      ciphertext: input.secret ? encrypt(input.secret) : saved.ciphertext,
      updatedAt: new Date(),
    });
  else
    insertRegistryCredential(db, {
      id: id(),
      projectId: input.projectId,
      name: input.name,
      registry: input.registry,
      username: input.username,
      ciphertext: encrypt(input.secret),
    });
  return listRegistryCredentials(input.projectId);
}
export function deleteRegistryCredential(projectId: string, credentialId: string) {
  deleteProjectRegistryCredential(projectId, credentialId);
  return { success: true };
}
