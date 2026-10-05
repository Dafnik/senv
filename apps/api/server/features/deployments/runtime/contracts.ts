import type { OriginResourceSample } from '../../../../shared/deployment-resources';
import type { DeploymentSnapshot, DeploymentStatus } from '../../../../shared/deployments';
export type PreviewRouteTargets = {
  baseDomain: string;
  deployments: Array<{ deploymentId: string; projectSlug: string }>;
  branches: Array<{ branchAlias: string; projectSlug: string; deploymentId: string }>;
  tags: Array<{ tag: string; projectSlug: string; deploymentId: string }>;
};

export type RuntimeConfig = Pick<
  DeploymentSnapshot,
  'kind' | 'artifactId' | 'port' | 'env' | 'health' | 'spaFallback' | 'proxy' | 'limits'
> & {
  id: string;
  projectId: string;
  imageDigest?: string | null;
  secrets: Record<string, string>;
  registryAuth?: { serverAddress: string; username: string; password: string };
  logs: DeploymentSnapshot['logs'];
  desiredState: 'running' | 'stopped';
  status: DeploymentStatus;
  submittedAt: Date;
};

type MaybePromise<T> = T | Promise<T>;

/** Persistence and lifecycle operations used by the Docker reconciler. */
export interface RuntimeServices {
  recordDeploymentResourceSample(id: string, sample: OriginResourceSample, at?: Date): void;
  pruneDeploymentResourceSamples(now?: Date): void;
  registerPreviewRoutesRefresh(callback: () => Promise<void>): void;
  registerDeploymentRemovalHandler(
    callback: (id: string, projectId: string) => Promise<void>,
  ): void;
  resumePendingDeploymentRemovals(): Promise<number>;
  cleanupDueDeployments(): Promise<number>;
  getPreviewRouteTargets(): PreviewRouteTargets;
  listDeploymentRuntimeConfigs(): RuntimeConfig[];
  getDeploymentRuntimeConfig(id: string): RuntimeConfig | null;
  markDeploymentStarting(id: string): MaybePromise<RuntimeConfig | null>;
  markDeploymentReady(id: string, at: Date): Promise<void>;
  markDeploymentFailed(
    id: string,
    reason: string,
    at?: Date,
    options?: { stopRuntime?: boolean },
  ): Promise<void>;
  setDeploymentHealth(
    id: string,
    status: 'healthy' | 'unhealthy',
    reason?: string,
    at?: Date,
  ): Promise<void>;
  setDeploymentImageDigest(id: string, digest: string): MaybePromise<void>;
  getArtifact(
    id: string,
    projectId?: string,
  ): MaybePromise<{ projectId: string; kind: DeploymentSnapshot['kind']; storageKey: string }>;
  getArtifactCleanupState(): { referenced: string[]; pending: string[]; released: string[] };
  forgetArtifactStorageKey(key: string): boolean;
  appendDeploymentLog(id: string, source: 'origin' | 'proxy', content: string): void;
}
