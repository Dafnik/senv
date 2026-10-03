import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import * as z from 'zod';
import { deployment } from '../../../../../drizzle/schema';
import { publishDeploymentSchema, registryServerSchema } from '../../../shared/deployments';
import { db } from '../../utils/db';
import {
  assignDeploymentTag,
  deleteDeployment,
  deleteRegistryCredential,
  getDeploymentLogs,
  getProjectDeployment,
  listDeploymentHistory,
  listProjectDeployments,
  listRegistryCredentials,
  publishDeployment,
  removeDeploymentHistory,
  removeDeploymentTag,
  requestDeploymentStart,
  saveRegistryCredential,
  stopDeployment,
  setDeploymentPinned,
} from '../../utils/deployments';
import { assertProjectAccess } from '../../utils/project-access';
import { requestDeploymentPreview } from '../../utils/deployment-preview-status';
import { authedProcedure, router } from '../trpc';

const projectIdInput = z.object({ projectId: z.string().min(1) });
const deploymentInput = z.object({ projectId: z.string().min(1), deploymentId: z.string().min(1) });
function accessibleDeployment(
  projectId: string,
  deploymentId: string,
  actor: { id: string; role?: string | null },
  permission: 'read' | 'manage' = 'read',
) {
  assertProjectAccess(projectId, actor, permission === 'manage');
  const row = db
    .select()
    .from(deployment)
    .where(and(eq(deployment.id, deploymentId), eq(deployment.projectId, projectId)))
    .get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found.' });
  return row;
}

export const deploymentsRouter = router({
  list: authedProcedure.input(projectIdInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user);
    return {
      deployments: listProjectDeployments(input.projectId),
      baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    };
  }),
  detail: authedProcedure.input(deploymentInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user);
    const detail = getProjectDeployment(input.projectId, input.deploymentId);
    return {
      ...detail,
      history: listDeploymentHistory(input.projectId, 100, undefined, input.deploymentId),
      baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    };
  }),
  previewStatus: authedProcedure.input(deploymentInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user);
    const detail = getProjectDeployment(input.projectId, input.deploymentId);
    return requestDeploymentPreview(detail.previewUrl);
  }),
  publish: authedProcedure.input(publishDeploymentSchema).mutation(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, true);
    return publishDeployment(input, ctx.user);
  }),
  setPinned: authedProcedure
    .input(deploymentInput.extend({ pinned: z.boolean() }))
    .mutation(({ ctx, input }) => {
      accessibleDeployment(input.projectId, input.deploymentId, ctx.user, 'manage');
      return setDeploymentPinned(input.projectId, input.deploymentId, input.pinned, ctx.user);
    }),
  stop: authedProcedure.input(deploymentInput).mutation(({ ctx, input }) => {
    accessibleDeployment(input.projectId, input.deploymentId, ctx.user, 'manage');
    return stopDeployment(input.deploymentId, ctx.user);
  }),
  restart: authedProcedure.input(deploymentInput).mutation(({ ctx, input }) => {
    accessibleDeployment(input.projectId, input.deploymentId, ctx.user, 'manage');
    return requestDeploymentStart(input.deploymentId, ctx.user);
  }),
  delete: authedProcedure.input(deploymentInput).mutation(({ ctx, input }) => {
    accessibleDeployment(input.projectId, input.deploymentId, ctx.user, 'manage');
    return deleteDeployment(input.deploymentId, ctx.user);
  }),
  history: authedProcedure
    .input(
      projectIdInput.extend({
        limit: z.number().int().min(1).max(200).default(100),
        cursor: z.number().int().nonnegative().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user);
      return listDeploymentHistory(input.projectId, input.limit, input.cursor);
    }),
  removeHistory: authedProcedure.input(deploymentInput).mutation(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, false, true);
    return removeDeploymentHistory(input.projectId, input.deploymentId);
  }),
  assignTag: authedProcedure
    .input(deploymentInput.extend({ name: z.string().trim().min(1).max(63) }))
    .mutation(async ({ ctx, input }) => {
      accessibleDeployment(input.projectId, input.deploymentId, ctx.user, 'manage');
      return assignDeploymentTag(input.projectId, input.name, input.deploymentId, ctx.user);
    }),
  removeTag: authedProcedure
    .input(projectIdInput.extend({ name: z.string().trim().min(1).max(63) }))
    .mutation(async ({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, true);
      return removeDeploymentTag(input.projectId, input.name, ctx.user);
    }),
  logs: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        deploymentId: z.string().min(1),
        source: z.enum(['proxy', 'origin']),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.object({ sequence: z.number().int().positive() }).optional(),
      }),
    )
    .query(({ ctx, input }) => {
      accessibleDeployment(input.projectId, input.deploymentId, ctx.user);
      return getDeploymentLogs(input.deploymentId, input.source, input.limit, input.cursor);
    }),
  registryCredentials: authedProcedure.input(projectIdInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, true);
    return listRegistryCredentials(input.projectId);
  }),
  saveRegistryCredential: authedProcedure
    .input(
      projectIdInput.extend({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(100),
        registry: registryServerSchema,
        username: z.string().trim().min(1).max(256),
        secret: z.string().max(8192).default(''),
      }),
    )
    .mutation(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, true);
      return saveRegistryCredential(input);
    }),
  deleteRegistryCredential: authedProcedure
    .input(projectIdInput.extend({ credentialId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, true);
      return deleteRegistryCredential(input.projectId, input.credentialId);
    }),
});
