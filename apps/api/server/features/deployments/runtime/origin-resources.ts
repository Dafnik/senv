import type { OriginResourceSample } from '../../../../shared/deployment-resources';
export type { OriginResourceSample } from '../../../../shared/deployment-resources';
import type { DockerEngine } from '../../../infrastructure/docker-engine';
import { containerName } from './preview-routes';

type ContainerInspect = {
  Id?: string;
  State?: { Running?: boolean };
  Config?: { Labels?: Record<string, string> };
};

type DockerStats = {
  read?: string;
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: { inactive_file?: number; total_inactive_file?: number; cache?: number };
  };
};

export async function readOriginResourceSample(options: {
  engine: DockerEngine;
  instanceId: string;
  projectId: string;
  deploymentId: string;
}): Promise<OriginResourceSample> {
  const name = containerName(options.instanceId, options.deploymentId, 'origin');
  let container: ContainerInspect;
  try {
    container = (
      await options.engine.request<ContainerInspect>(
        'GET',
        `/containers/${encodeURIComponent(name)}/json`,
      )
    ).body;
  } catch (error) {
    if (isNotFound(error)) return unavailable('container-missing');
    return unavailable('stats-unavailable');
  }

  const labels = container.Config?.Labels;
  if (
    labels?.['senv.managed'] !== 'true' ||
    labels['senv.instance'] !== options.instanceId ||
    labels['senv.deployment'] !== options.deploymentId ||
    labels['senv.project'] !== options.projectId ||
    labels['senv.role'] !== 'origin'
  )
    return unavailable('container-missing');
  if (!container.State?.Running || !container.Id) return unavailable('container-stopped');

  try {
    const stats = (
      await options.engine.request<DockerStats>(
        'GET',
        `/containers/${encodeURIComponent(container.Id)}/stats?stream=false`,
      )
    ).body;
    const sampledAt =
      stats.read && Number.isFinite(Date.parse(stats.read)) ? new Date(stats.read) : new Date();
    const sample = convertDockerStats(stats);
    return sample
      ? { status: 'available', sampledAt, ...sample }
      : { status: 'unavailable', sampledAt, reason: 'stats-unavailable' };
  } catch {
    return unavailable('stats-unavailable');
  }
}

export function convertDockerStats(
  stats: DockerStats,
): Omit<Extract<OriginResourceSample, { status: 'available' }>, 'status' | 'sampledAt'> | null {
  const currentCpu = stats.cpu_stats;
  const previousCpu = stats.precpu_stats;
  const currentUsage = currentCpu?.cpu_usage?.total_usage;
  const previousUsage = previousCpu?.cpu_usage?.total_usage;
  const currentSystem = currentCpu?.system_cpu_usage;
  const previousSystem = previousCpu?.system_cpu_usage;
  const cpuDelta = (currentUsage ?? Number.NaN) - (previousUsage ?? Number.NaN);
  const systemDelta = (currentSystem ?? Number.NaN) - (previousSystem ?? Number.NaN);
  const cpuCount =
    currentCpu?.online_cpus ?? currentCpu?.cpu_usage?.percpu_usage?.length ?? Number.NaN;
  const memory = stats.memory_stats;
  const usage = memory?.usage;
  const limit = memory?.limit;
  if (
    !Number.isFinite(cpuDelta) ||
    !Number.isFinite(systemDelta) ||
    cpuDelta < 0 ||
    systemDelta <= 0 ||
    !Number.isFinite(cpuCount) ||
    cpuCount <= 0 ||
    !Number.isFinite(usage) ||
    !Number.isFinite(limit) ||
    (usage ?? -1) < 0 ||
    (limit ?? -1) <= 0
  )
    return null;

  const inactiveFile = memory?.stats?.total_inactive_file ?? memory?.stats?.inactive_file;
  const cache = memory?.stats?.cache;
  const reclaimable = Number.isFinite(inactiveFile)
    ? inactiveFile!
    : Number.isFinite(cache)
      ? cache!
      : 0;
  return {
    cpuPercent: Math.max(0, (cpuDelta / systemDelta) * cpuCount * 100),
    memoryUsedBytes: reclaimable < usage! ? usage! - reclaimable : usage!,
    memoryLimitBytes: limit!,
  };
}

function unavailable(
  reason: Extract<OriginResourceSample, { status: 'unavailable' }>['reason'],
): OriginResourceSample {
  return { status: 'unavailable', sampledAt: new Date(), reason };
}

function isNotFound(error: unknown): boolean {
  return String(error).includes('(404)');
}
