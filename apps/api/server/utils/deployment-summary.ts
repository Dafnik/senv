import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import {
  deployment,
  deploymentBranchAlias,
  deploymentTag,
  organization,
} from '../../../../drizzle/schema';
import type { PublicDeployment } from '../../shared/deployments';
import { db } from './db';
import { canonicalJson, runtimeFingerprint } from './deployment-secrets';
import {
  getProjectDeploymentSettings,
  getInstanceDeploymentDefaults,
  projectRuntimeValues,
} from './project-deployment-settings';

function currentConfiguration(projectId: string) {
  return {
    settings: getProjectDeploymentSettings(projectId),
    defaults: getInstanceDeploymentDefaults(),
    runtime: projectRuntimeValues(projectId),
    slug:
      db
        .select({ slug: organization.previewSlug })
        .from(organization)
        .where(eq(organization.id, projectId))
        .get()?.slug ?? '',
  };
}
function configurationChanges(
  row: typeof deployment.$inferSelect,
  current: ReturnType<typeof currentConfiguration>,
): string[] {
  const snapshot = row.snapshot;
  const changed: string[] = [];
  const compare = (name: string, saved: unknown, latest: unknown) => {
    if (canonicalJson(saved) !== canonicalJson(latest)) changed.push(name);
  };
  compare('Deployment retention', snapshot.retentionDays, current.settings.retentionDays);
  compare('Repository', snapshot.source.repository ?? '', current.settings.repository);
  compare('Git provider', snapshot.source.repositoryProvider, current.settings.repositoryProvider);
  if (row.kind === 'static')
    compare('Client-side routing', snapshot.spaFallback, current.settings.spaFallback);
  compare('Health checks', snapshot.health, current.settings.health);
  compare('Proxy routes, cache and compression', snapshot.proxy, current.settings.proxy);
  compare(
    'Origin resources',
    { cpus: Number(snapshot.limits.origin.cpus), memoryBytes: snapshot.limits.origin.memoryBytes },
    { cpus: Number(current.settings.originCpus), memoryBytes: current.settings.originMemoryBytes },
  );
  compare(
    'Proxy resources',
    { cpus: Number(snapshot.limits.proxy.cpus), memoryBytes: snapshot.limits.proxy.memoryBytes },
    { cpus: Number(current.defaults.proxyCpus), memoryBytes: current.defaults.proxyMemoryBytes },
  );
  compare('Log retention', snapshot.logs, {
    files: current.defaults.logFiles,
    fileSizeBytes: current.defaults.logFileSizeBytes,
  });
  compare('Environment variables', snapshot.env, current.runtime.env);
  if (snapshot.runtimeFingerprint !== runtimeFingerprint({ ...current.runtime, env: snapshot.env }))
    changed.push('Runtime secrets');
  return changed;
}

function publicDeployment(
  row: typeof deployment.$inferSelect,
  current = currentConfiguration(row.projectId),
): PublicDeployment {
  const changes = configurationChanges(row, current);
  const snapshot = row.snapshot;
  const source = row.source;
  const snapshotSecrets = snapshot.secretNames;
  const branch = db
    .select()
    .from(deploymentBranchAlias)
    .where(eq(deploymentBranchAlias.deploymentId, row.id))
    .get();
  const tags = db
    .select({ name: deploymentTag.name })
    .from(deploymentTag)
    .where(eq(deploymentTag.deploymentId, row.id))
    .all()
    .map((tag) => tag.name);
  return {
    id: row.id,
    previewUrl: `${process.env['PREVIEW_TLS'] === 'false' ? 'http' : 'https'}://${row.id}.${current.slug}.${process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost'}`,
    configurationOutdated: changes.length > 0,
    configurationChanges: changes,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    removalPending: row.cleanupStartedAt !== null,
    desiredState: row.desiredState,
    pinned: row.pinned,
    artifactId: row.artifactId,
    imageDigest: row.imageDigest,
    source,
    submittedAt: row.submittedAt,
    readyAt: row.readyAt,
    retentionStartedAt: row.retentionStartedAt,
    retentionDeadlineAt: row.retentionDeadlineAt,
    failureReason: row.failureReason,
    config: {
      retentionDays: snapshot.retentionDays,
      image: snapshot.image ?? undefined,
      port: snapshot.port,
      env: snapshot.env,
      spaFallback: snapshot.spaFallback,
      health: snapshot.health,
      proxy: snapshot.proxy,
      limits: snapshot.limits,
      logs: snapshot.logs,
      secretNames: snapshotSecrets,
      hasSecrets: snapshotSecrets.length > 0,
    },
    branchAlias: branch?.alias ?? null,
    tags,
  };
}
export function listProjectDeployments(projectId: string) {
  const current = currentConfiguration(projectId);
  return db
    .select()
    .from(deployment)
    .where(eq(deployment.projectId, projectId))
    .orderBy(desc(deployment.submissionOrder))
    .all()
    .map((row) => publicDeployment(row, current));
}
export function getProjectDeployment(projectId: string, deploymentId: string) {
  const row = db
    .select()
    .from(deployment)
    .where(and(eq(deployment.id, deploymentId), eq(deployment.projectId, projectId)))
    .get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found.' });
  return publicDeployment(row);
}
