import * as z from 'zod';

export const deploymentHistorySortFields = ['createdAt', 'event', 'deploymentId', 'actor'] as const;

export const deploymentHistoryQuerySchema = z
  .object({
    projectId: z.string().min(1),
    deploymentId: z.string().min(1).optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(200).default(20),
    cursor: z
      .union([
        z.number().int().nonnegative(),
        z.object({ createdAt: z.date(), id: z.string().min(1) }),
      ])
      .optional(),
    search: z.string().trim().max(254).default(''),
    event: z.string().trim().min(1).optional(),
    actor: z.string().trim().min(1).optional(),
    sortBy: z.enum(deploymentHistorySortFields).default('createdAt'),
    sortDirection: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine(
    (input) =>
      input.cursor === undefined ||
      (input.offset === 0 && input.sortBy === 'createdAt' && input.sortDirection === 'desc'),
    { message: 'History cursors require descending creation order and no offset.' },
  );

export type DeploymentHistoryQuery = z.infer<typeof deploymentHistoryQuerySchema>;

import type { DeploymentActor } from './deployment-types';

export type DeploymentHistoryEntry = {
  id: string;
  projectId: string;
  deploymentId: string;
  event: string;
  actorType: 'user' | 'system';
  actor: DeploymentActor | null;
  details: Record<string, unknown>;
  createdAt: Date;
};
