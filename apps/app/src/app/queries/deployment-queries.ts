import { Injectable } from '@angular/core';
import type {
  DeploymentLogPage,
  DeploymentLogCursor,
} from '@senv/api/shared/deployments';
import type { DeploymentAuditQuery } from '@senv/api/shared/deployment-audit';
import { deploymentKeys } from './deployment-keys';
import { injectTrpc } from '../trpc/trpc.service';

@Injectable({ providedIn: 'root' })
export class DeploymentQueries {
  private readonly trpc = injectTrpc();

  list(sessionId: string | null, projectId: string, enabled = true) {
    return {
      queryKey: deploymentKeys.list(sessionId, projectId),
      enabled: !!sessionId && !!projectId && enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.deployments.list
          .query({ projectId }, { signal })
          .then((result) => result.deployments),
      refetchInterval: 5_000,
    };
  }

  detail(sessionId: string | null, projectId: string, deploymentId: string) {
    return {
      queryKey: deploymentKeys.detail(sessionId, projectId, deploymentId),
      enabled: !!sessionId && !!projectId && !!deploymentId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.deployments.detail.query(
          { projectId, deploymentId },
          { signal },
        ),
      refetchInterval: 5_000,
    };
  }

  history(sessionId: string | null, projectId: string, enabled = true) {
    return {
      queryKey: deploymentKeys.history(sessionId, projectId),
      enabled: !!sessionId && !!projectId && enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.deployments.history.query(
          { projectId, limit: 50 },
          { signal },
        ),
      refetchInterval: 10_000,
    };
  }

  audit(sessionId: string | null, input: DeploymentAuditQuery) {
    return {
      queryKey: deploymentKeys.audit(sessionId, input),
      enabled: !!sessionId && !!input.projectId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.deployments.audit.query(input, { signal }),
      refetchInterval: 10_000,
    };
  }

  previewStatus(
    sessionId: string | null,
    projectId: string,
    deploymentId: string,
    enabled = true,
  ) {
    return {
      queryKey: deploymentKeys.previewStatus(
        sessionId,
        projectId,
        deploymentId,
      ),
      enabled: !!sessionId && !!projectId && !!deploymentId && enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.deployments.previewStatus.query(
          { projectId, deploymentId },
          { signal },
        ),
      refetchInterval: 30_000,
      retry: false,
    };
  }

  logs(
    sessionId: string | null,
    projectId: string,
    deploymentId: string,
    source: 'proxy' | 'origin',
  ) {
    return {
      queryKey: deploymentKeys.logs(sessionId, projectId, deploymentId, source),
      enabled: !!sessionId && !!deploymentId,
      initialPageParam: undefined as DeploymentLogCursor | undefined,
      queryFn: ({
        pageParam,
        signal,
      }: {
        pageParam: DeploymentLogCursor | undefined;
        signal: AbortSignal;
      }) =>
        this.trpc.client.deployments.logs
          .query(
            { projectId, deploymentId, source, limit: 100, cursor: pageParam },
            { signal },
          )
          .then((page) => page as unknown as DeploymentLogPage),
      getNextPageParam: (page: DeploymentLogPage) =>
        page.nextCursor ?? undefined,
    };
  }

  resources(
    sessionId: string | null,
    projectId: string,
    deploymentId: string,
    enabled = true,
  ) {
    return {
      queryKey: deploymentKeys.resources(sessionId, projectId, deploymentId),
      enabled: !!sessionId && !!projectId && !!deploymentId && enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.deployments.resources.query(
          { projectId, deploymentId },
          { signal },
        ),
      refetchInterval: enabled ? 2_000 : (false as const),
      refetchIntervalInBackground: false,
      retry: false,
    };
  }

  settings(sessionId: string | null, projectId: string) {
    return {
      queryKey: deploymentKeys.settings(sessionId, projectId),
      enabled: !!sessionId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.projects.deploymentSettings.query(
          { projectId },
          { signal },
        ),
    };
  }

  runtime(sessionId: string | null, projectId: string, enabled = true) {
    return {
      queryKey: deploymentKeys.runtime(sessionId, projectId),
      enabled: !!sessionId && enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.projects.runtime.query({ projectId }, { signal }),
    };
  }

  credentials(sessionId: string | null, projectId: string, enabled = true) {
    return {
      queryKey: deploymentKeys.credentials(sessionId, projectId),
      enabled: !!sessionId && enabled,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.deployments.registryCredentials.query(
          { projectId },
          { signal },
        ),
    };
  }

  adminDefaults(sessionId: string | null) {
    return {
      queryKey: deploymentKeys.adminDefaults(sessionId),
      enabled: !!sessionId,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        this.trpc.client.admin.deploymentDefaults.query(undefined, { signal }),
    };
  }
}
