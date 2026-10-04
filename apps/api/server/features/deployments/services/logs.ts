import { customAlphabet } from 'nanoid';
import type { DeploymentLogCursor, DeploymentLogPage } from '../../../../shared/deployments';
import { db } from '../../../infrastructure/db';
import { findDeploymentLogSettings } from '../repositories/deployments';
import {
  deleteLogsThroughSequence,
  getRetainedLogBytes,
  insertDeploymentLog,
  listDeploymentLogRows,
  listOldestLogSizes,
} from '../repositories/logs';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export function getDeploymentLogs(
  deploymentId: string,
  source: 'proxy' | 'origin',
  limit = 100,
  cursor?: DeploymentLogCursor,
): DeploymentLogPage {
  const page = listDeploymentLogRows(deploymentId, source, limit, cursor);
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
  const row = findDeploymentLogSettings(deploymentId);
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
    insertDeploymentLog(tx, {
      id: id(),
      deploymentId,
      source,
      content: clipped,
      createdAt: new Date(),
    });
    const retainedBytes = getRetainedLogBytes(tx, deploymentId, source)!.bytes;
    if (retainedBytes <= maxBytes) return;

    let bytes = retainedBytes;
    let throughSequence: number | undefined;
    let afterSequence: number | undefined;
    while (bytes > maxBytes) {
      const oldest = listOldestLogSizes(tx, deploymentId, source, afterSequence);
      if (!oldest.length) break;
      for (const row of oldest) {
        throughSequence = row.sequence;
        bytes -= row.bytes;
        if (bytes <= maxBytes) break;
      }
      afterSequence = oldest[oldest.length - 1]!.sequence;
    }
    if (throughSequence !== undefined)
      deleteLogsThroughSequence(tx, deploymentId, source, throughSequence);
  });
}
