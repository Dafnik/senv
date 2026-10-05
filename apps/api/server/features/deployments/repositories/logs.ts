import { and, asc, desc, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { deploymentLog } from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';

export function insertDeploymentLog(
  database: QueryHandle,
  values: typeof deploymentLog.$inferInsert,
) {
  return database.insert(deploymentLog).values(values).run();
}

export function listDeploymentLogRows(
  deploymentId: string,
  source: 'proxy' | 'origin',
  limit: number,
  cursor?: { sequence: number },
) {
  return db
    .select()
    .from(deploymentLog)
    .where(
      and(
        eq(deploymentLog.deploymentId, deploymentId),
        eq(deploymentLog.source, source),
        cursor ? lt(deploymentLog.sequence, cursor.sequence) : undefined,
      ),
    )
    .orderBy(desc(deploymentLog.sequence))
    .limit(Math.min(limit, 500) + 1)
    .all();
}

export function forwardDeploymentLogs(
  deploymentId: string,
  source: 'proxy' | 'origin',
  limit: number,
  afterSequence?: number,
) {
  const scope = and(eq(deploymentLog.deploymentId, deploymentId), eq(deploymentLog.source, source));
  const first = db
    .select({ sequence: deploymentLog.sequence })
    .from(deploymentLog)
    .where(scope)
    .orderBy(asc(deploymentLog.sequence))
    .limit(1)
    .get();
  const gap =
    afterSequence !== undefined && first !== undefined && first.sequence > afterSequence + 1;
  const rows = db
    .select()
    .from(deploymentLog)
    .where(
      and(
        scope,
        afterSequence === undefined ? undefined : gt(deploymentLog.sequence, afterSequence),
      ),
    )
    .orderBy(
      afterSequence === undefined ? desc(deploymentLog.sequence) : asc(deploymentLog.sequence),
    )
    .limit(limit + 1)
    .all();
  const logs = rows.slice(0, limit);
  if (afterSequence === undefined) logs.reverse();
  return {
    logs,
    afterSequence: logs.at(-1)?.sequence ?? afterSequence ?? 0,
    hasMore: afterSequence !== undefined && rows.length > limit,
    retentionGap: Boolean(gap),
  };
}

export function getRetainedLogBytes(
  tx: QueryHandle,
  deploymentId: string,
  source: 'proxy' | 'origin',
) {
  return tx
    .select({
      bytes: sql<number>`coalesce(sum(length(cast(${deploymentLog.content} as blob))), 0)`,
    })
    .from(deploymentLog)
    .where(and(eq(deploymentLog.deploymentId, deploymentId), eq(deploymentLog.source, source)))
    .get();
}

export function listOldestLogSizes(
  tx: QueryHandle,
  deploymentId: string,
  source: 'proxy' | 'origin',
  afterSequence?: number,
) {
  return tx
    .select({
      sequence: deploymentLog.sequence,
      bytes: sql<number>`length(cast(${deploymentLog.content} as blob))`,
    })
    .from(deploymentLog)
    .where(
      and(
        eq(deploymentLog.deploymentId, deploymentId),
        eq(deploymentLog.source, source),
        afterSequence === undefined ? undefined : gt(deploymentLog.sequence, afterSequence),
      ),
    )
    .orderBy(asc(deploymentLog.sequence))
    .limit(512)
    .all();
}

export function deleteLogsThroughSequence(
  tx: QueryHandle,
  deploymentId: string,
  source: 'proxy' | 'origin',
  throughSequence: number,
) {
  return tx
    .delete(deploymentLog)
    .where(
      and(
        eq(deploymentLog.deploymentId, deploymentId),
        eq(deploymentLog.source, source),
        lte(deploymentLog.sequence, throughSequence),
      ),
    )
    .run();
}

export function deleteDeploymentLogForDeployment(tx: QueryHandle, deploymentId: string) {
  return tx.delete(deploymentLog).where(eq(deploymentLog.deploymentId, deploymentId)).run();
}
