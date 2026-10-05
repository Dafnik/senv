import {
  RESOURCE_HISTORY_DURATION_MS,
  RESOURCE_SAMPLE_INTERVAL_MS,
  type OriginResourceSample,
  type DeploymentResourceHistory,
} from '../../../../shared/deployment-resources';
import { findDeployment } from '../repositories/deployments';
import {
  listDeploymentResourceSamples,
  saveDeploymentResourceSample,
  pruneResourceSamples,
} from '../repositories/resources';
import { DockerEngine } from '../../../infrastructure/docker-engine';
import { deploymentInstanceId } from '../runtime/identity';
import { readOriginResourceSample } from '../runtime/origin-resources';
export function getDeploymentResources(projectId: string, deploymentId: string) {
  return readOriginResourceSample({
    engine: new DockerEngine(),
    instanceId: deploymentInstanceId(),
    projectId,
    deploymentId,
  });
}

export function recordDeploymentResourceSample(
  deploymentId: string,
  sample: OriginResourceSample,
  at = new Date(),
) {
  const row = findDeployment(deploymentId);
  if (!row || row.deletedAt || row.cleanupStartedAt) return;
  const sampledAt = new Date(
    Math.floor(at.getTime() / RESOURCE_SAMPLE_INTERVAL_MS) * RESOURCE_SAMPLE_INTERVAL_MS,
  );
  saveDeploymentResourceSample({
    deploymentId,
    sampledAt,
    cpuPercent: sample.status === 'available' ? sample.cpuPercent : null,
    memoryUsedBytes: sample.status === 'available' ? sample.memoryUsedBytes : null,
    memoryLimitBytes: sample.status === 'available' ? sample.memoryLimitBytes : null,
  });
}

export function pruneDeploymentResourceSamples(now = new Date()) {
  pruneResourceSamples(new Date(now.getTime() - RESOURCE_HISTORY_DURATION_MS));
}

export function getDeploymentResourceHistory(
  deploymentId: string,
  now = new Date(),
): DeploymentResourceHistory {
  const from = new Date(now.getTime() - RESOURCE_HISTORY_DURATION_MS);
  const rows = listDeploymentResourceSamples(deploymentId, from, now);
  const samples = new Map(rows.map((row) => [row.sampledAt.getTime(), row]));
  const count = RESOURCE_HISTORY_DURATION_MS / RESOURCE_SAMPLE_INTERVAL_MS;
  const latest =
    Math.floor(now.getTime() / RESOURCE_SAMPLE_INTERVAL_MS) * RESOURCE_SAMPLE_INTERVAL_MS;
  return {
    from,
    to: now,
    intervalMs: RESOURCE_SAMPLE_INTERVAL_MS,
    points: Array.from({ length: count }, (_, i) => {
      const at = latest - (count - 1 - i) * RESOURCE_SAMPLE_INTERVAL_MS;
      const row = samples.get(at);
      return {
        sampledAt: new Date(at),
        cpuPercent: row?.cpuPercent ?? null,
        memoryUsedBytes: row?.memoryUsedBytes ?? null,
        memoryLimitBytes: row?.memoryLimitBytes ?? null,
      };
    }),
  };
}
