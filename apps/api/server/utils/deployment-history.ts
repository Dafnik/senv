import { TRPCError } from '@trpc/server';
import { and, desc, eq, lt } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { deployment, deploymentHistory } from '../../../../drizzle/schema';
import type { DeploymentActor } from '../../shared/deployments';
import { db } from './db';
import type { DeploymentQueryHandle } from './deployment-retention';

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
  cursor?: number,
  deploymentId?: string,
) {
  return db
    .select()
    .from(deploymentHistory)
    .where(
      and(
        eq(deploymentHistory.projectId, projectId),
        deploymentId ? eq(deploymentHistory.deploymentId, deploymentId) : undefined,
        cursor ? lt(deploymentHistory.createdAt, new Date(cursor)) : undefined,
      ),
    )
    .orderBy(desc(deploymentHistory.createdAt), desc(deploymentHistory.id))
    .limit(Math.min(limit, 200))
    .all();
}

export function removeDeploymentHistory(projectId: string, deploymentId: string) {
  const row = db
    .select()
    .from(deployment)
    .where(and(eq(deployment.id, deploymentId), eq(deployment.projectId, projectId)))
    .get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment history not found.' });
  if (!['deleted', 'cleaned'].includes(row.status) || row.artifactId)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Only deleted or cleaned deployments can have their history permanently removed.',
    });
  db.transaction((tx) => {
    tx.delete(deploymentHistory)
      .where(
        and(
          eq(deploymentHistory.projectId, projectId),
          eq(deploymentHistory.deploymentId, deploymentId),
        ),
      )
      .run();
    tx.delete(deployment).where(eq(deployment.id, deploymentId)).run();
  });
  return { success: true };
}
