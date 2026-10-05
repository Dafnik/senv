import * as z from 'zod';
import { deploymentKindSchema, deploymentStatusSchema } from './deployment-routing-schemas';
import type { RepositoryProvider } from './deployment-routing-schemas';
import {
  deploymentSettingsSchema,
  instanceDeploymentDefaultsSchema,
  publishDeploymentSchema,
} from './deployment-config-schemas';
import { deploymentHealthSchema, deploymentProxySchema } from './deployment-proxy-schemas';

export type DeploymentActor = { id: string; name: string };

export type DeploymentKind = z.infer<typeof deploymentKindSchema>;
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;
export type DeploymentHealth = z.infer<typeof deploymentHealthSchema>;
export type DeploymentProxy = z.infer<typeof deploymentProxySchema>;
export type DeploymentSettings = z.infer<typeof deploymentSettingsSchema>;
export type InstanceDeploymentDefaults = z.infer<typeof instanceDeploymentDefaultsSchema>;
export type PublishDeploymentInput = z.infer<typeof publishDeploymentSchema>;

export type DeploymentSource = PublishDeploymentInput['source'] & {
  repository?: string;
  repositoryProvider?: RepositoryProvider;
};

export type DeploymentSnapshot = {
  kind: DeploymentKind;
  artifactId: string | null;
  image: string | null;
  registryCredentialId: string | null;
  pinned: boolean;
  source: DeploymentSource;
  secretNames: string[];
  port: number;
  env: Record<string, string>;
  spaFallback: boolean;
  runtimeFingerprint: string;
  retentionDays: number;
  health: DeploymentHealth;
  proxy: DeploymentProxy;
  limits: {
    origin: { cpus: string; memoryBytes: number };
    proxy: { cpus: string; memoryBytes: number };
  };
  logs: { files: number; fileSizeBytes: number };
};

export type PublicDeployment = {
  id: string;
  projectId: string;
  kind: DeploymentKind;
  status: DeploymentStatus;
  removalPending: boolean;
  configurationOutdated: boolean;
  configurationChanges: string[];
  previewUrl: string;
  addresses?: { fixed: string; branch: string | null; tags: { name: string; url: string }[] };
  desiredState: 'running' | 'stopped';
  pinned: boolean;
  artifactId: string | null;
  imageDigest: string | null;
  source: DeploymentSource;
  submittedAt: Date;
  readyAt: Date | null;
  retentionStartedAt: Date | null;
  retentionDeadlineAt: Date | null;
  failureReason: string | null;
  config: {
    retentionDays: number;
    image?: string;
    registryCredentialId?: string | null;
    port: number;
    env: Record<string, string>;
    spaFallback: boolean;
    health: DeploymentHealth;
    proxy: DeploymentProxy;
    limits: {
      origin: { cpus: string; memoryBytes: number };
      proxy: { cpus: string; memoryBytes: number };
    };
    logs: { files: number; fileSizeBytes: number };
    secretNames: string[];
    hasSecrets: boolean;
  };
  branchAlias: string | null;
  tags: string[];
};

export type DeploymentLogCursor = { sequence: number };
export type DeploymentPreviewStatus = {
  url: string;
  statusCode: number | null;
  checkedAt: Date;
  responseTimeMs: number;
  error: string | null;
};
export type DeploymentLogPage = {
  logs: Array<{
    id: string;
    deploymentId: string;
    source: 'proxy' | 'origin';
    content: string;
    createdAt: Date;
  }>;
  nextCursor: DeploymentLogCursor | null;
};
