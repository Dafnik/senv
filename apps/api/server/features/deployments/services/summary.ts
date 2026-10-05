import { TRPCError } from '@trpc/server';
import { deployment } from '../../../../../../drizzle/schema';
import type { PublicDeployment } from '../../../../shared/deployments';
import { getInstanceDeploymentDefaults } from '../../admin/services/deployment-defaults';
import { findProject } from '../../projects/repositories/projects';
import {
  getProjectDeploymentSettings,
  projectRuntimeValues,
} from '../../projects/services/deployment-settings';
import { canonicalJson, runtimeFingerprint } from '../domain/secrets';
import {
  findDeployment,
  findDeploymentBranchAlias,
  listDeploymentTags,
  listProjectBranchAliases,
  listProjectDeploymentRows,
  listProjectDeploymentTags,
} from '../repositories/deployments';

function currentConfiguration(projectId: string) {
  return {
    settings: getProjectDeploymentSettings(projectId),
    defaults: getInstanceDeploymentDefaults(),
    runtime: projectRuntimeValues(projectId),
    slug: findProject(projectId)?.previewSlug ?? '',
  };
}
function configurationChanges(
  row: typeof deployment.$inferSelect,
  current: ReturnType<typeof currentConfiguration>,
  currentRuntimeFingerprint: string,
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
  if (snapshot.runtimeFingerprint !== currentRuntimeFingerprint) changed.push('Runtime secrets');
  return changed;
}

function publicDeployment(
  row: typeof deployment.$inferSelect,
  current = currentConfiguration(row.projectId),
  relations?: { branchAlias: string | null; tags: string[] },
  currentRuntimeFingerprint = runtimeFingerprint({ ...current.runtime, env: row.snapshot.env }),
): PublicDeployment {
  const changes = configurationChanges(row, current, currentRuntimeFingerprint);
  const snapshot = row.snapshot;
  const source = row.source;
  const snapshotSecrets = snapshot.secretNames;
  const branchAlias = relations
    ? relations.branchAlias
    : (findDeploymentBranchAlias(row.id, row.projectId)?.alias ?? null);
  const tags = relations?.tags ?? listDeploymentTags(row.id, row.projectId).map((tag) => tag.name);
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
      registryCredentialId: snapshot.registryCredentialId,
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
    branchAlias,
    tags,
  };
}
export function listProjectDeployments(projectId: string) {
  const current = currentConfiguration(projectId);
  const rows = listProjectDeploymentRows(projectId);
  if (!rows.length) return [];
  const aliases = listProjectBranchAliases(projectId);
  const aliasByDeployment = new Map<string | null, string>();
  for (const entry of aliases)
    if (!aliasByDeployment.has(entry.deploymentId))
      aliasByDeployment.set(entry.deploymentId, entry.alias);
  const tags = listProjectDeploymentTags(projectId);
  const tagsByDeployment = new Map<string, string[]>();
  for (const tag of tags) {
    const names = tagsByDeployment.get(tag.deploymentId) ?? [];
    names.push(tag.name);
    tagsByDeployment.set(tag.deploymentId, names);
  }
  const fingerprints = new Map<string, string>();
  return rows.map((row) => {
    const environment = canonicalJson(row.snapshot.env);
    let fingerprint = fingerprints.get(environment);
    if (!fingerprint) {
      fingerprint = runtimeFingerprint({ ...current.runtime, env: row.snapshot.env });
      fingerprints.set(environment, fingerprint);
    }
    return publicDeployment(
      row,
      current,
      {
        branchAlias: aliasByDeployment.get(row.id) ?? null,
        tags: tagsByDeployment.get(row.id) ?? [],
      },
      fingerprint,
    );
  });
}
export function getProjectDeployment(projectId: string, deploymentId: string) {
  const row = findDeployment(deploymentId, projectId);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found.' });
  return publicDeployment(row);
}
