import { TRPCError } from '@trpc/server';
import { db } from '../../../infrastructure/db';
import { deleteDeploymentRecord, findDeployment } from '../repositories/deployments';
import { deleteDeploymentEvents } from '../repositories/history';
export { event, listDeploymentHistory } from '../repositories/history';
export function removeDeploymentHistory(projectId: string, deploymentId: string) {
  const row = findDeployment(deploymentId, projectId);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment history not found.' });
  if (!['deleted', 'cleaned'].includes(row.status) || row.artifactId)
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Only deleted or cleaned deployments can have their history permanently removed.',
    });
  db.transaction((tx) => {
    deleteDeploymentEvents(tx, projectId, deploymentId);
    deleteDeploymentRecord(tx, deploymentId);
  });
  return { success: true };
}

export { listDeploymentHistoryPage } from '../repositories/history-page';
