import { TRPCError } from '@trpc/server';
import { assertProjectAccess } from '../../projects/services/access';
import { findDeployment } from '../repositories/deployments';

export function accessibleDeployment(
  projectId: string,
  deploymentId: string,
  actor: { id: string; role?: string | null },
  permission: 'read' | 'manage' = 'read',
) {
  assertProjectAccess(projectId, actor, permission);
  const row = findDeployment(deploymentId, projectId);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found.' });
  return row;
}
