import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import {
  deployment,
  deploymentBranchAlias,
  deploymentTag,
  organization,
} from '../../../../drizzle/schema';
import { isValidPreviewHostname, type DeploymentActor } from '../../shared/deployments';
import { deploymentTagNameSchema } from '../../shared/deployment-tags';
import { db } from './db';
import { event } from './deployment-history';
import { updateRetention } from './deployment-retention';
import { refreshOrRollback, serializeRouteMutation } from './deployment-routing';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);

export function branchAlias(branch: string, projectId: string) {
  const clean =
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'branch';
  const label = clean.slice(0, 60).replace(/-+$/g, '');
  const alias = `br-${label}`;
  const collision = db
    .select()
    .from(deploymentBranchAlias)
    .where(
      and(eq(deploymentBranchAlias.projectId, projectId), eq(deploymentBranchAlias.alias, alias)),
    )
    .get();
  if (collision && collision.branch !== branch)
    throw new TRPCError({
      code: 'CONFLICT',
      message: `Branch address ${alias} is already used by ${collision.branch}. Choose a different branch name.`,
    });
  return alias;
}

export async function assignDeploymentTag(
  projectId: string,
  name: string,
  deploymentId: string,
  actor?: DeploymentActor,
) {
  return serializeRouteMutation(async () => {
    if (!deploymentTagNameSchema.safeParse(name).success)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Tags must be lowercase DNS labels and cannot start with br-.',
      });
    if (
      db
        .select({ id: deployment.id })
        .from(deployment)
        .where(and(eq(deployment.projectId, projectId), eq(deployment.id, name)))
        .get()
    )
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Tag names cannot match a deployment ID.',
      });
    const project = db.select().from(organization).where(eq(organization.id, projectId)).get();
    if (
      !project ||
      !isValidPreviewHostname(
        project.previewSlug,
        name,
        process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
      )
    )
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The tag hostname exceeds DNS limits or the configured preview domain is invalid.',
      });
    const target = db
      .select()
      .from(deployment)
      .where(and(eq(deployment.id, deploymentId), eq(deployment.projectId, projectId)))
      .get();
    if (
      !target ||
      target.cleanupStartedAt ||
      target.status !== 'healthy' ||
      target.desiredState !== 'running'
    )
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Tags can only select a healthy deployment that is not being removed.',
      });
    const prior = db
      .select()
      .from(deploymentTag)
      .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, name)))
      .get();
    const affectedIds = [
      ...new Set(
        [prior?.deploymentId, deploymentId].filter((value): value is string => Boolean(value)),
      ),
    ];
    const retention = affectedIds
      .map((value) =>
        db
          .select({
            id: deployment.id,
            retentionStartedAt: deployment.retentionStartedAt,
            retentionDeadlineAt: deployment.retentionDeadlineAt,
          })
          .from(deployment)
          .where(eq(deployment.id, value))
          .get(),
      )
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
    db.transaction((tx) => {
      if (prior) tx.delete(deploymentTag).where(eq(deploymentTag.id, prior.id)).run();
      tx.insert(deploymentTag).values({ id: id(), projectId, name, deploymentId }).run();
      if (prior) updateRetention(tx, prior.deploymentId, true);
      updateRetention(tx, deploymentId, false);
    });
    await refreshOrRollback(() =>
      db.transaction((tx) => {
        tx.delete(deploymentTag)
          .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, name)))
          .run();
        if (prior) tx.insert(deploymentTag).values(prior).run();
        for (const value of retention)
          tx.update(deployment)
            .set({
              retentionStartedAt: value.retentionStartedAt,
              retentionDeadlineAt: value.retentionDeadlineAt,
            })
            .where(eq(deployment.id, value.id))
            .run();
      }),
    );
    event(db, projectId, deploymentId, 'tag-assigned', { name }, new Date(), actor);
    return { success: true };
  });
}
export async function removeDeploymentTag(
  projectId: string,
  name: string,
  actor?: DeploymentActor,
) {
  return serializeRouteMutation(async () => {
    const tag = db
      .select()
      .from(deploymentTag)
      .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, name)))
      .get();
    if (!tag) return { success: true };
    const priorDeployment = db
      .select({
        retentionStartedAt: deployment.retentionStartedAt,
        retentionDeadlineAt: deployment.retentionDeadlineAt,
      })
      .from(deployment)
      .where(eq(deployment.id, tag.deploymentId))
      .get();
    db.transaction((tx) => {
      tx.delete(deploymentTag).where(eq(deploymentTag.id, tag.id)).run();
      updateRetention(tx, tag.deploymentId, true);
    });
    await refreshOrRollback(() =>
      db.transaction((tx) => {
        tx.insert(deploymentTag).values(tag).run();
        if (priorDeployment)
          tx.update(deployment)
            .set(priorDeployment)
            .where(eq(deployment.id, tag.deploymentId))
            .run();
      }),
    );
    event(db, projectId, tag.deploymentId, 'tag-removed', { name }, new Date(), actor);
    return { success: true };
  });
}

export * from './deployment-preview-addresses';
