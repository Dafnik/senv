import { TRPCError } from '@trpc/server';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  deployment,
  deploymentBranchAlias,
  deploymentTag,
  organization,
} from '../../../../drizzle/schema';
import { isValidPreviewHostname } from '../../shared/deployments';
import { previewSlugSchema } from '../../shared/validation';
import { db } from './db';
import { refreshOrRollback, serializeRouteMutation } from './deployment-routing';

export function getPreviewRouteTargets() {
  const projects = db
    .select({ id: organization.id, projectSlug: organization.previewSlug })
    .from(organization)
    .all();
  const projectSlugs = new Map(projects.map((project) => [project.id, project.projectSlug]));
  const availableDeployments = db
    .select({ deploymentId: deployment.id, projectId: deployment.projectId })
    .from(deployment)
    .where(
      and(
        isNull(deployment.deletedAt),
        isNull(deployment.cleanupStartedAt),
        eq(deployment.desiredState, 'running'),
        or(eq(deployment.status, 'healthy'), eq(deployment.status, 'unhealthy')),
      ),
    )
    .all();
  const available = new Set(availableDeployments.map((target) => target.deploymentId));
  return {
    baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    deployments: availableDeployments.map((target) => ({
      deploymentId: target.deploymentId,
      projectSlug: projectSlugs.get(target.projectId)!,
    })),
    branches: db
      .select({
        branchAlias: deploymentBranchAlias.alias,
        projectId: deploymentBranchAlias.projectId,
        deploymentId: deploymentBranchAlias.deploymentId,
      })
      .from(deploymentBranchAlias)
      .all()
      .filter((target) => target.deploymentId && available.has(target.deploymentId))
      .map((target) => ({
        branchAlias: target.branchAlias,
        projectSlug: projectSlugs.get(target.projectId)!,
        deploymentId: target.deploymentId!,
      })),
    tags: db
      .select()
      .from(deploymentTag)
      .all()
      .filter((target) => available.has(target.deploymentId))
      .map((target) => ({
        tag: target.name,
        projectSlug: projectSlugs.get(target.projectId)!,
        deploymentId: target.deploymentId,
      })),
  };
}

export async function updateProjectPreviewSlug(projectId: string, slug: string) {
  return serializeRouteMutation(async () => {
    if (!previewSlugSchema.safeParse(slug).success)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Preview slugs must be lowercase DNS labels with letters, digits, and internal hyphens.',
      });
    const conflict = db
      .select()
      .from(organization)
      .where(and(eq(organization.previewSlug, slug), sql`${organization.id} <> ${projectId}`))
      .get();
    if (conflict)
      throw new TRPCError({ code: 'CONFLICT', message: 'That preview slug is already in use.' });
    const domain = process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost';
    if (!isValidPreviewHostname(slug, 'a'.repeat(63), domain))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'The configured preview domain leaves no room for valid deployment, branch, and tag labels.',
      });
    const tooLong = db
      .select()
      .from(deployment)
      .where(eq(deployment.projectId, projectId))
      .all()
      .some((row) => !isValidPreviewHostname(slug, row.id, domain));
    if (tooLong)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The generated preview hostname would exceed the DNS name limit.',
      });
    const before = db.select().from(organization).where(eq(organization.id, projectId)).get();
    if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
    const saved = db
      .update(organization)
      .set({ previewSlug: slug })
      .where(eq(organization.id, projectId))
      .returning()
      .get();
    await refreshOrRollback(() =>
      db
        .update(organization)
        .set({ previewSlug: before.previewSlug })
        .where(and(eq(organization.id, projectId), eq(organization.previewSlug, slug)))
        .run(),
    );
    return saved;
  });
}
