import { TRPCError } from '@trpc/server';
import { customAlphabet } from 'nanoid';
import { db } from '../../../infrastructure/db';
import {
  deleteArtifactStorageKey,
  findArtifact,
  findArtifactReference,
  insertArtifact,
  listArtifactReferences,
  listArtifactStorageKeys,
  listArtifacts,
  listArtifactsByStorageKey,
} from '../repositories/artifacts';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export function registerUploadedArtifact(input: {
  projectId: string;
  kind: 'static';
  storageKey: string;
  size: number;
  sha256: string;
}) {
  if (
    !/^[a-f0-9]{64}$/.test(input.storageKey) ||
    input.storageKey !== input.sha256 ||
    !Number.isSafeInteger(input.size) ||
    input.size < 1
  )
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Artifact metadata is invalid.' });
  const artifactId = id();
  insertArtifact(db, { id: artifactId, ...input });
  return { artifactId, size: input.size, sha256: input.sha256 };
}
export function getArtifact(artifactId: string, projectId?: string) {
  const artifact = findArtifact(artifactId, projectId);
  if (!artifact) throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found.' });
  return artifact;
}
export function listReferencedArtifactStorageKeys() {
  const artifactIds = new Set(listArtifactReferences().map((row) => row.artifactId!));
  return listArtifactStorageKeys()
    .filter((artifact) => artifactIds.has(artifact.id))
    .map((artifact) => artifact.storageKey);
}
export function getArtifactCleanupState(now = new Date()) {
  const artifacts = listArtifacts();
  const referencedIds = new Set(listArtifactReferences().map((row) => row.artifactId!));
  const groups = new Map<string, { referenced: boolean; pending: boolean; published: boolean }>();
  for (const artifact of artifacts) {
    const state = groups.get(artifact.storageKey) ?? {
      referenced: false,
      pending: false,
      published: false,
    };
    state.referenced ||= referencedIds.has(artifact.id);
    state.published ||= artifact.publishedAt !== null;
    state.pending ||=
      artifact.publishedAt === null &&
      artifact.createdAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000;
    groups.set(artifact.storageKey, state);
  }
  const referenced: string[] = [],
    pending: string[] = [],
    released: string[] = [];
  for (const [key, state] of groups) {
    if (state.referenced) referenced.push(key);
    else if (state.pending) pending.push(key);
    else if (state.published) released.push(key);
  }
  return { referenced, pending, released };
}
export function forgetArtifactStorageKey(storageKey: string, now = new Date()) {
  const rows = listArtifactsByStorageKey(storageKey);
  if (
    rows.some(
      (row) =>
        findArtifactReference(row.id) ||
        (row.publishedAt === null && row.createdAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000),
    )
  )
    return false;
  deleteArtifactStorageKey(storageKey);
  return true;
}
