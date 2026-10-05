import { and, asc, desc, eq, isNotNull, isNull, lte, max, or } from 'drizzle-orm';
import {
  deployment,
  deploymentBranchAlias,
  deploymentSecret,
  deploymentTag,
} from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';
export type Deployment = typeof deployment.$inferSelect;
export function findDeployment(
  deploymentId: string,
  projectId?: string,
  database: QueryHandle = db,
) {
  return database
    .select()
    .from(deployment)
    .where(
      and(
        eq(deployment.id, deploymentId),
        projectId ? eq(deployment.projectId, projectId) : undefined,
      ),
    )
    .get();
}
export function updateDeployment(
  database: QueryHandle,
  deploymentId: string,
  values: Partial<typeof deployment.$inferInsert>,
) {
  return database.update(deployment).set(values).where(eq(deployment.id, deploymentId)).run();
}
export function deleteDeploymentRecord(database: QueryHandle, deploymentId: string) {
  database.delete(deployment).where(eq(deployment.id, deploymentId)).run();
}

export function findDeploymentBranchAlias(deploymentId: string, projectId: string) {
  return db
    .select({ alias: deploymentBranchAlias.alias })
    .from(deploymentBranchAlias)
    .where(
      and(
        eq(deploymentBranchAlias.deploymentId, deploymentId),
        eq(deploymentBranchAlias.projectId, projectId),
      ),
    )
    .get();
}

export function listDeploymentTags(deploymentId: string, projectId: string) {
  return db
    .select({ name: deploymentTag.name })
    .from(deploymentTag)
    .where(
      and(eq(deploymentTag.deploymentId, deploymentId), eq(deploymentTag.projectId, projectId)),
    )
    .all();
}

export function listProjectDeploymentRows(projectId: string) {
  return db
    .select()
    .from(deployment)
    .where(eq(deployment.projectId, projectId))
    .orderBy(desc(deployment.submissionOrder))
    .all();
}

export function listProjectBranchAliases(projectId: string) {
  return db
    .select({
      deploymentId: deploymentBranchAlias.deploymentId,
      alias: deploymentBranchAlias.alias,
    })
    .from(deploymentBranchAlias)
    .innerJoin(deployment, eq(deploymentBranchAlias.deploymentId, deployment.id))
    .where(and(eq(deploymentBranchAlias.projectId, projectId), eq(deployment.projectId, projectId)))
    .all();
}

export function listProjectDeploymentTags(projectId: string) {
  return db
    .select({ deploymentId: deploymentTag.deploymentId, name: deploymentTag.name })
    .from(deploymentTag)
    .innerJoin(deployment, eq(deploymentTag.deploymentId, deployment.id))
    .where(and(eq(deploymentTag.projectId, projectId), eq(deployment.projectId, projectId)))
    .all();
}

export function findDeploymentSecrets(deploymentId: string) {
  return db
    .select()
    .from(deploymentSecret)
    .where(eq(deploymentSecret.deploymentId, deploymentId))
    .get();
}

export function listActiveDeploymentRows() {
  return db
    .select()
    .from(deployment)
    .where(and(isNull(deployment.deletedAt), isNull(deployment.cleanupStartedAt)))
    .orderBy(asc(deployment.submissionOrder))
    .all();
}

export function listActiveDeploymentSecrets() {
  return db
    .select({ secret: deploymentSecret })
    .from(deploymentSecret)
    .innerJoin(deployment, eq(deploymentSecret.deploymentId, deployment.id))
    .where(and(isNull(deployment.deletedAt), isNull(deployment.cleanupStartedAt)))
    .all();
}

export function insertDeployment(database: QueryHandle, values: typeof deployment.$inferInsert) {
  return database.insert(deployment).values(values).run();
}

export function findDeploymentPin(tx: QueryHandle, deploymentId: string) {
  return tx
    .select({ pinned: deployment.pinned })
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .get();
}

export function listDueDeployments(now: Date) {
  return db
    .select()
    .from(deployment)
    .where(
      and(
        isNull(deployment.deletedAt),
        isNotNull(deployment.retentionDeadlineAt),
        lte(deployment.retentionDeadlineAt, now),
      ),
    )
    .all();
}

export function findDueDeployment(deploymentId: string, now: Date) {
  return db
    .select()
    .from(deployment)
    .where(
      and(
        eq(deployment.id, deploymentId),
        isNull(deployment.deletedAt),
        isNotNull(deployment.retentionDeadlineAt),
        lte(deployment.retentionDeadlineAt, now),
      ),
    )
    .get();
}

export function listPendingRemovals() {
  return db
    .select({ id: deployment.id })
    .from(deployment)
    .where(isNotNull(deployment.cleanupStartedAt))
    .orderBy(asc(deployment.submittedAt), asc(deployment.id))
    .all();
}

export function findDeploymentIdentity(candidate: string) {
  return db
    .select({ id: deployment.id })
    .from(deployment)
    .where(eq(deployment.id, candidate))
    .get();
}

export function findSubmissionOrder(projectId: string) {
  return db
    .select({ value: max(deployment.submissionOrder) })
    .from(deployment)
    .where(eq(deployment.projectId, projectId))
    .get();
}

export function findRetainedDeployment(deploymentId: string, projectId: string) {
  return db
    .select()
    .from(deployment)
    .where(
      and(
        eq(deployment.id, deploymentId),
        eq(deployment.projectId, projectId),
        isNull(deployment.deletedAt),
      ),
    )
    .get();
}

export function findDeploymentRetention(deploymentId: string) {
  return db
    .select({
      id: deployment.id,
      retentionStartedAt: deployment.retentionStartedAt,
      retentionDeadlineAt: deployment.retentionDeadlineAt,
    })
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .get();
}

export function findDeploymentRetentionDates(deploymentId: string) {
  return db
    .select({
      retentionStartedAt: deployment.retentionStartedAt,
      retentionDeadlineAt: deployment.retentionDeadlineAt,
    })
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .get();
}

export function listRoutableDeployments() {
  return db
    .select({ deploymentId: deployment.id, projectId: deployment.projectId })
    .from(deployment)
    .where(
      and(
        isNull(deployment.deletedAt),
        isNull(deployment.cleanupStartedAt),
        eq(deployment.desiredState, 'running'),
        or(eq(deployment.status, 'healthy'), eq(deployment.status, 'unhealthy')),
      ),
    )
    .all();
}

export function findDeploymentLogSettings(deploymentId: string) {
  return db
    .select({
      snapshot: deployment.snapshot,
      status: deployment.status,
      deletedAt: deployment.deletedAt,
      cleanupStartedAt: deployment.cleanupStartedAt,
    })
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .get();
}
