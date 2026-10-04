import { and, desc, eq, lt, or } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { deploymentHistory } from '../../../../../../drizzle/schema';
import type { DeploymentActor } from '../../../../shared/deployments';
import type { QueryHandle as DeploymentQueryHandle } from '../../../infrastructure/db';
import { db } from '../../../infrastructure/db';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export function event(
  tx: DeploymentQueryHandle,
  projectId: string,
  deploymentId: string,
  name: string,
  details: Record<string, unknown> = {},
  at = new Date(),
  actor?: DeploymentActor,
) {
  tx.insert(deploymentHistory)
    .values({
      id: id(),
      projectId,
      deploymentId,
      event: name,
      details,
      createdAt: at,
      actorType: actor ? 'user' : 'system',
      actor: actor ? { id: actor.id, name: actor.name } : null,
    })
    .run();
}

export function listDeploymentHistory(
  projectId: string,
  limit = 100,
  cursor?: number | { createdAt: Date; id: string },
  deploymentId?: string,
) {
  return db
    .select()
    .from(deploymentHistory)
    .where(
      and(
        eq(deploymentHistory.projectId, projectId),
        deploymentId ? eq(deploymentHistory.deploymentId, deploymentId) : undefined,
        typeof cursor === 'number'
          ? lt(deploymentHistory.createdAt, new Date(cursor))
          : cursor
            ? or(
                lt(deploymentHistory.createdAt, cursor.createdAt),
                and(
                  eq(deploymentHistory.createdAt, cursor.createdAt),
                  lt(deploymentHistory.id, cursor.id),
                ),
              )
            : undefined,
      ),
    )
    .orderBy(desc(deploymentHistory.createdAt), desc(deploymentHistory.id))
    .limit(Math.min(limit, 200))
    .all();
}

export function deleteDeploymentEvents(
  tx: DeploymentQueryHandle,
  projectId: string,
  deploymentId: string,
) {
  tx.delete(deploymentHistory)
    .where(
      and(
        eq(deploymentHistory.projectId, projectId),
        eq(deploymentHistory.deploymentId, deploymentId),
      ),
    )
    .run();
}

export function findDeploymentHistoryIdentity(candidate: string) {
  return db
    .select({ id: deploymentHistory.id })
    .from(deploymentHistory)
    .where(eq(deploymentHistory.deploymentId, candidate))
    .get();
}
