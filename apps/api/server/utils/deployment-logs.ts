import { and, asc, desc, eq, gt, lt, lte, sql } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { deployment, deploymentLog } from '../../../../drizzle/schema';
import type { DeploymentLogCursor, DeploymentLogPage } from '../../shared/deployments';
import { db } from './db';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export function getDeploymentLogs(
  deploymentId: string,
  source: 'proxy' | 'origin',
  limit = 100,
  cursor?: DeploymentLogCursor,
): DeploymentLogPage {
  const page = db
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
  const hasOlder = page.length > Math.min(limit, 500);
  const rows = page.slice(0, Math.min(limit, 500));
  const oldest = rows[rows.length - 1];
  return {
    logs: rows.reverse().map((row) => ({ ...row, source })),
    nextCursor: hasOlder && oldest ? { sequence: oldest.sequence } : null,
  };
}
export function appendDeploymentLog(
  deploymentId: string,
  source: 'proxy' | 'origin',
  content: string,
) {
  const row = db
    .select({
      snapshot: deployment.snapshot,
      status: deployment.status,
      deletedAt: deployment.deletedAt,
      cleanupStartedAt: deployment.cleanupStartedAt,
    })
    .from(deployment)
    .where(eq(deployment.id, deploymentId))
    .get();
  if (
    !row ||
    row.deletedAt ||
    row.cleanupStartedAt ||
    row.status === 'deleted' ||
    row.status === 'cleaned'
  )
    return;
  const limits = row.snapshot.logs;
  const maxBytes = Math.max(1024, limits.files * limits.fileSizeBytes);
  const encoded = Buffer.from(content, 'utf8');
  let start = Math.max(0, encoded.length - maxBytes);
  while (start < encoded.length && (encoded[start]! & 0xc0) === 0x80) start++;
  const clipped = encoded.subarray(start).toString('utf8');
  db.transaction((tx) => {
    tx.insert(deploymentLog)
      .values({ id: id(), deploymentId, source, content: clipped, createdAt: new Date() })
      .run();
    const retainedBytes = tx
      .select({
        bytes: sql<number>`coalesce(sum(length(cast(${deploymentLog.content} as blob))), 0)`,
      })
      .from(deploymentLog)
      .where(and(eq(deploymentLog.deploymentId, deploymentId), eq(deploymentLog.source, source)))
      .get()!.bytes;
    if (retainedBytes <= maxBytes) return;

    let bytes = retainedBytes;
    let throughSequence: number | undefined;
    let afterSequence: number | undefined;
    while (bytes > maxBytes) {
      const oldest = tx
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
      if (!oldest.length) break;
      for (const row of oldest) {
        throughSequence = row.sequence;
        bytes -= row.bytes;
        if (bytes <= maxBytes) break;
      }
      afterSequence = oldest[oldest.length - 1]!.sequence;
    }
    if (throughSequence !== undefined)
      tx.delete(deploymentLog)
        .where(
          and(
            eq(deploymentLog.deploymentId, deploymentId),
            eq(deploymentLog.source, source),
            lte(deploymentLog.sequence, throughSequence),
          ),
        )
        .run();
  });
}
