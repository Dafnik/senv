import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { deployment, deploymentArtifact } from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';

export function updateArtifact(
  database: QueryHandle,
  id: string,
  values: Partial<typeof deploymentArtifact.$inferInsert>,
) {
  return database.update(deploymentArtifact).set(values).where(eq(deploymentArtifact.id, id)).run();
}

export function insertArtifact(
  database: QueryHandle,
  values: typeof deploymentArtifact.$inferInsert,
) {
  return database.insert(deploymentArtifact).values(values).run();
}

export function findArtifact(artifactId: string, projectId?: string) {
  return db
    .select()
    .from(deploymentArtifact)
    .where(
      projectId
        ? and(eq(deploymentArtifact.id, artifactId), eq(deploymentArtifact.projectId, projectId))
        : eq(deploymentArtifact.id, artifactId),
    )
    .get();
}

export function listArtifactReferences() {
  return db
    .select({ artifactId: deployment.artifactId })
    .from(deployment)
    .where(isNotNull(deployment.artifactId))
    .all();
}

export function listArtifactStorageKeys() {
  return db
    .select({ id: deploymentArtifact.id, storageKey: deploymentArtifact.storageKey })
    .from(deploymentArtifact)
    .all();
}

export function listArtifacts() {
  return db.select().from(deploymentArtifact).all();
}

export function listProjectArtifacts(projectId: string, limit: number, offset: number) {
  const condition = and(
    eq(deploymentArtifact.projectId, projectId),
    eq(deploymentArtifact.kind, 'static'),
    isNotNull(deploymentArtifact.publishedAt),
  );
  return {
    items: db
      .select()
      .from(deploymentArtifact)
      .where(condition)
      .orderBy(desc(deploymentArtifact.createdAt), desc(deploymentArtifact.id))
      .limit(limit)
      .offset(offset)
      .all(),
    total: db.select({ value: count() }).from(deploymentArtifact).where(condition).get()!.value,
  };
}

export function listArtifactDeployments(projectId: string, artifactIds: string[]) {
  if (!artifactIds.length) return [];
  return db
    .select({
      id: deployment.id,
      artifactId: deployment.artifactId,
      status: deployment.status,
      source: deployment.source,
    })
    .from(deployment)
    .where(and(eq(deployment.projectId, projectId), inArray(deployment.artifactId, artifactIds)))
    .orderBy(deployment.submissionOrder)
    .all();
}

export function listArtifactsByStorageKey(storageKey: string) {
  return db
    .select()
    .from(deploymentArtifact)
    .where(eq(deploymentArtifact.storageKey, storageKey))
    .all();
}

export function findArtifactReference(artifactId: string) {
  return db
    .select({ id: deployment.id })
    .from(deployment)
    .where(eq(deployment.artifactId, artifactId))
    .get();
}

export function deleteArtifactStorageKey(storageKey: string) {
  return db.delete(deploymentArtifact).where(eq(deploymentArtifact.storageKey, storageKey)).run();
}
