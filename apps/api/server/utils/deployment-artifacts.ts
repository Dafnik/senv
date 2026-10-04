import { TRPCError } from '@trpc/server';
import { and, eq, isNotNull } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { deployment, deploymentArtifact } from '../../../../drizzle/schema';
import { db } from './db';

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
  db.insert(deploymentArtifact)
    .values({ id: artifactId, ...input })
    .run();
  return { artifactId, size: input.size, sha256: input.sha256 };
}
export function getArtifact(artifactId: string, projectId?: string) {
  const artifact = db
    .select()
    .from(deploymentArtifact)
    .where(
      projectId
        ? and(eq(deploymentArtifact.id, artifactId), eq(deploymentArtifact.projectId, projectId))
        : eq(deploymentArtifact.id, artifactId),
    )
    .get();
  if (!artifact) throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found.' });
  return artifact;
}
export function listReferencedArtifactStorageKeys() {
  const artifactIds = new Set(
    db
      .select({ artifactId: deployment.artifactId })
      .from(deployment)
      .where(isNotNull(deployment.artifactId))
      .all()
      .map((row) => row.artifactId!),
  );
  return db
    .select({ id: deploymentArtifact.id, storageKey: deploymentArtifact.storageKey })
    .from(deploymentArtifact)
    .all()
    .filter((artifact) => artifactIds.has(artifact.id))
    .map((artifact) => artifact.storageKey);
}
export function getArtifactCleanupState(now = new Date()) {
  const artifacts = db.select().from(deploymentArtifact).all();
  const referencedIds = new Set(
    db
      .select({ artifactId: deployment.artifactId })
      .from(deployment)
      .where(isNotNull(deployment.artifactId))
      .all()
      .map((row) => row.artifactId!),
  );
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
  const rows = db
    .select()
    .from(deploymentArtifact)
    .where(eq(deploymentArtifact.storageKey, storageKey))
    .all();
  if (
    rows.some(
      (row) =>
        db
          .select({ id: deployment.id })
          .from(deployment)
          .where(eq(deployment.artifactId, row.id))
          .get() ||
        (row.publishedAt === null && row.createdAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000),
    )
  )
    return false;
  db.delete(deploymentArtifact).where(eq(deploymentArtifact.storageKey, storageKey)).run();
  return true;
}
