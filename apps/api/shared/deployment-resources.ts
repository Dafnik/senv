export const RESOURCE_SAMPLE_INTERVAL_MS = 30_000;
export const RESOURCE_HISTORY_DURATION_MS = 20 * 60 * 1000;

export type OriginResourceSample =
  | {
      status: 'available';
      sampledAt: Date;
      cpuPercent: number;
      memoryUsedBytes: number;
      memoryLimitBytes: number | null;
    }
  | {
      status: 'unavailable';
      sampledAt: Date;
      reason: 'container-missing' | 'container-stopped' | 'stats-unavailable';
    };

export type DeploymentResourcePoint = {
  sampledAt: Date;
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryLimitBytes: number | null;
};

export type DeploymentResourceHistory = {
  from: Date;
  to: Date;
  intervalMs: number;
  points: DeploymentResourcePoint[];
};
