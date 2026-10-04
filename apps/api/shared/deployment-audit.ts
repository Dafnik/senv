import * as z from 'zod';

export const deploymentAuditSortFields = ['createdAt', 'event', 'deploymentId', 'actor'] as const;

export const deploymentAuditQuerySchema = z.object({
  projectId: z.string().min(1),
  deploymentId: z.string().min(1).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(254).default(''),
  event: z.string().trim().min(1).optional(),
  actor: z.string().trim().min(1).optional(),
  sortBy: z.enum(deploymentAuditSortFields).default('createdAt'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

export type DeploymentAuditQuery = z.infer<typeof deploymentAuditQuerySchema>;

import type { DeploymentActor } from './deployment-types';

export type DeploymentAuditEntry = {
  id: string;
  projectId: string;
  deploymentId: string;
  event: string;
  actorType: 'user' | 'system';
  actor: DeploymentActor | null;
  details: Record<string, unknown>;
  createdAt: Date;
};
