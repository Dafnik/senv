import { and, asc, desc, eq, lt } from 'drizzle-orm';
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
    const rows = tx
      .select({ id: deploymentLog.id, content: deploymentLog.content })
      .from(deploymentLog)
      .where(and(eq(deploymentLog.deploymentId, deploymentId), eq(deploymentLog.source, source)))
      .orderBy(asc(deploymentLog.sequence))
      .all();
    let bytes = rows.reduce((total, item) => total + Buffer.byteLength(item.content), 0);
    for (const item of rows) {
      if (bytes <= maxBytes) break;
      tx.delete(deploymentLog).where(eq(deploymentLog.id, item.id)).run();
      bytes -= Buffer.byteLength(item.content);
    }
  });
}
