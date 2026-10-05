import * as z from 'zod';
import { deploymentHistoryQuerySchema } from '../../../shared/deployment-history';
import { registryCredentialInputSchema } from '../../../shared/deployment-credentials';
import { publishDeploymentSchema } from '../../../shared/deployments';
import { authedProcedure, router } from '../../trpc/trpc';
import { assertProjectAccess } from '../projects/services/access';
import {
  assignDeploymentTag,
  deleteDeployment,
  deleteRegistryCredential,
  getDeploymentLogs,
  getProjectDeployment,
  listDeploymentHistoryPage,
  listProjectDeployments,
  listRegistryCredentials,
  publishDeployment,
  removeDeploymentHistory,
  removeDeploymentTag,
  requestDeploymentStart,
  saveRegistryCredential,
  setDeploymentPinned,
  stopDeployment,
} from './index';
import { accessibleDeployment } from './services/access';
import { requestDeploymentPreview } from './services/preview-status';
import { getDeploymentResources, getDeploymentResourceHistory } from './services/resources';
import { forwardDeploymentLogs } from './repositories/logs';
import { createShellGrant, shellInput } from './services/shell';
import { getInstanceDeploymentDefaults } from '../admin/services/deployment-defaults';
import { maxStaticArtifactEntries } from './runtime/artifact-limits';

const projectIdInput = z.object({ projectId: z.string().min(1) });
const deploymentInput = z.object({ projectId: z.string().min(1), deploymentId: z.string().min(1) });
export const deploymentsRouter = router({
  uploadConstraints: authedProcedure.input(projectIdInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'manage');
    return {
      maxBytes: getInstanceDeploymentDefaults().uploadLimitBytes,
      maxEntries: maxStaticArtifactEntries,
    };
  }),
  shellGrant: authedProcedure
    .input(shellInput)
    .mutation(({ ctx, input }) => createShellGrant(ctx, input)),
  logsForward: authedProcedure
    .input(
      deploymentInput.extend({
        source: z.enum(['origin', 'proxy']),
        limit: z.number().int().min(1).max(500).default(100),
        afterSequence: z.number().int().nonnegative().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      accessibleDeployment(input.projectId, input.deploymentId, ctx.user, 'read');
      return forwardDeploymentLogs(
        input.deploymentId,
        input.source,
        input.limit,
        input.afterSequence,
      );
    }),
  list: authedProcedure.input(projectIdInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'read');
    return {
      deployments: listProjectDeployments(input.projectId),
      baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    };
  }),
  detail: authedProcedure.input(deploymentInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'read');
    const detail = getProjectDeployment(input.projectId, input.deploymentId);
    return {
      ...detail,
      baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    };
  }),
  previewStatus: authedProcedure.input(deploymentInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'read');
    const detail = getProjectDeployment(input.projectId, input.deploymentId);
    return requestDeploymentPreview(detail.previewUrl);
  }),
  publish: authedProcedure.input(publishDeploymentSchema).mutation(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'manage');
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
  history: authedProcedure.input(deploymentHistoryQuerySchema).query(({ ctx, input }) => {
    if (input.deploymentId)
      accessibleDeployment(input.projectId, input.deploymentId, ctx.user, 'read');
    else assertProjectAccess(input.projectId, ctx.user, 'read');
    return listDeploymentHistoryPage(input);
  }),
  removeHistory: authedProcedure.input(deploymentInput).mutation(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'admin');
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
      assertProjectAccess(input.projectId, ctx.user, 'manage');
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
  resourceHistory: authedProcedure.input(deploymentInput).query(({ ctx, input }) => {
    accessibleDeployment(input.projectId, input.deploymentId, ctx.user, 'read');
    return getDeploymentResourceHistory(input.deploymentId);
  }),
  resources: authedProcedure.input(deploymentInput).query(({ ctx, input }) => {
    accessibleDeployment(input.projectId, input.deploymentId, ctx.user, 'read');
    return getDeploymentResources(input.projectId, input.deploymentId);
  }),
  registryCredentials: authedProcedure.input(projectIdInput).query(({ ctx, input }) => {
    assertProjectAccess(input.projectId, ctx.user, 'manage');
    return listRegistryCredentials(input.projectId);
  }),
  saveRegistryCredential: authedProcedure
    .input(projectIdInput.extend(registryCredentialInputSchema.shape))
    .mutation(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'manage');
      return saveRegistryCredential(input);
    }),
  deleteRegistryCredential: authedProcedure
    .input(projectIdInput.extend({ credentialId: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      assertProjectAccess(input.projectId, ctx.user, 'manage');
      return deleteRegistryCredential(input.projectId, input.credentialId);
    }),
});
