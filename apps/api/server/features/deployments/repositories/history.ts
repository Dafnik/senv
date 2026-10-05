import { deploymentHistoryQuerySchema } from '../../../../shared/deployment-history';
import { listDeploymentHistoryPage } from './history-page';
import { and, eq } from 'drizzle-orm';
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

/** Internal callers share the same history query as the web and CLI. */
export function listDeploymentHistory(
  projectId: string,
  limit = 100,
  cursor?: number | { createdAt: Date; id: string },
  deploymentId?: string,
) {
  return listDeploymentHistoryPage(
    deploymentHistoryQuerySchema.parse({ projectId, limit, cursor, deploymentId }),
  ).entries;
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
