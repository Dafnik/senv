import type { DeploymentHistoryQuery } from '@senv/api/shared/deployment-history';

export const deploymentKeys = {
  list: (sessionId: string | null, projectId: string) =>
    ['deployments', sessionId, projectId] as const,
  detail: (sessionId: string | null, projectId: string, deploymentId: string) =>
    ['deployment', sessionId, projectId, deploymentId] as const,
  detailPrefix: (sessionId: string | null, projectId: string) =>
    ['deployment', sessionId, projectId] as const,
  previewStatus: (
    sessionId: string | null,
    projectId: string,
    deploymentId: string,
  ) =>
    ['deployment-preview-status', sessionId, projectId, deploymentId] as const,
  previewStatusPrefix: (sessionId: string | null, projectId: string) =>
    ['deployment-preview-status', sessionId, projectId] as const,
  logs: (
    sessionId: string | null,
    projectId: string,
    deploymentId: string,
    source: 'proxy' | 'origin',
  ) => ['deployment-logs', sessionId, projectId, deploymentId, source] as const,
  resources: (
    sessionId: string | null,
    projectId: string,
    deploymentId: string,
  ) => ['deployment-resources', sessionId, projectId, deploymentId] as const,
  resourceHistory: (
    sessionId: string | null,
    projectId: string,
    deploymentId: string,
  ) =>
    [
      'deployment-resource-history',
      sessionId,
      projectId,
      deploymentId,
    ] as const,
  logsPrefix: (sessionId: string | null, projectId: string) =>
    ['deployment-logs', sessionId, projectId] as const,
  history: (sessionId: string | null, input: DeploymentHistoryQuery) =>
    ['deployment-history', sessionId, input.projectId, input] as const,
  historyPrefix: (sessionId: string | null, projectId: string) =>
    ['deployment-history', sessionId, projectId] as const,
  settings: (sessionId: string | null, projectId: string) =>
    ['deployment-settings', sessionId, projectId] as const,
  runtime: (sessionId: string | null, projectId: string) =>
    ['project-runtime', sessionId, projectId] as const,
  credentials: (sessionId: string | null, projectId: string) =>
    ['registry-credentials', sessionId, projectId] as const,
  adminDefaults: (sessionId: string | null) =>
    ['deployment-admin-defaults', sessionId] as const,
};
