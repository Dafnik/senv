import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { QueryClient } from '@tanstack/angular-query';
import type {
  DeploymentLogPage,
  DeploymentSettings,
  DeploymentLogCursor,
  InstanceDeploymentDefaults,
  PublishDeploymentInput,
  ProjectRuntimeUpdate,
} from '@senv/api/shared/deployments';
import { environment } from '../../environments/environment';
import { injectTrpc } from '../trpc/trpc.service';

export const deploymentKeys = {
  list: (sessionId: string | null, projectId: string) =>
    ['deployments', sessionId, projectId] as const,
  detail: (sessionId: string | null, projectId: string, deploymentId: string) =>
    ['deployment', sessionId, projectId, deploymentId] as const,
  history: (sessionId: string | null, projectId: string) =>
    ['deployment-history', sessionId, projectId] as const,
  logs: (
    sessionId: string | null,
    projectId: string,
    deploymentId: string,
    source: 'proxy' | 'origin',
  ) => ['deployment-logs', sessionId, projectId, deploymentId, source] as const,
  settings: (sessionId: string | null, projectId: string) =>
    ['deployment-settings', sessionId, projectId] as const,
  runtime: (sessionId: string | null, projectId: string) =>
    ['project-runtime', sessionId, projectId] as const,
  credentials: (sessionId: string | null, projectId: string) =>
    ['registry-credentials', sessionId, projectId] as const,
  adminDefaults: (sessionId: string | null) =>
    ['deployment-admin-defaults', sessionId] as const,
};

@Injectable({ providedIn: 'root' })
export class DeploymentsData {
  private readonly trpc = injectTrpc();
  private readonly http = inject(HttpClient);
  private readonly queries = inject(QueryClient);

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
  updateRuntime(projectId: string, runtime: ProjectRuntimeUpdate) {
    return this.trpc.client.projects.updateRuntime.mutate({
      projectId,
      runtime,
    });
  }
  setPinned(projectId: string, deploymentId: string, pinned: boolean) {
    return this.trpc.client.deployments.setPinned.mutate({
      projectId,
      deploymentId,
      pinned,
    });
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

  publish(input: PublishDeploymentInput) {
    return this.trpc.client.deployments.publish.mutate(input);
  }
  stop(projectId: string, deploymentId: string) {
    return this.trpc.client.deployments.stop.mutate({
      projectId,
      deploymentId,
    });
  }
  restart(projectId: string, deploymentId: string) {
    return this.trpc.client.deployments.restart.mutate({
      projectId,
      deploymentId,
    });
  }
  remove(projectId: string, deploymentId: string) {
    return this.trpc.client.deployments.delete.mutate({
      projectId,
      deploymentId,
    });
  }
  assignTag(projectId: string, name: string, deploymentId: string) {
    return this.trpc.client.deployments.assignTag.mutate({
      projectId,
      name,
      deploymentId,
    });
  }
  removeTag(projectId: string, name: string) {
    return this.trpc.client.deployments.removeTag.mutate({ projectId, name });
  }
  removeHistory(projectId: string, deploymentId: string) {
    return this.trpc.client.deployments.removeHistory.mutate({
      projectId,
      deploymentId,
    });
  }
  updateSettings(projectId: string, settings: DeploymentSettings) {
    return this.trpc.client.projects.updateDeploymentSettings.mutate({
      projectId,
      settings,
    });
  }
  saveRegistryCredential(input: {
    projectId: string;
    name: string;
    registry: string;
    username: string;
    secret: string;
  }) {
    return this.trpc.client.deployments.saveRegistryCredential.mutate(input);
  }
  deleteRegistryCredential(projectId: string, credentialId: string) {
    return this.trpc.client.deployments.deleteRegistryCredential.mutate({
      projectId,
      credentialId,
    });
  }
  updateAdminDefaults(defaults: InstanceDeploymentDefaults) {
    return this.trpc.client.admin.updateDeploymentDefaults.mutate(defaults);
  }

  async invalidate(sessionId: string | null, projectId: string) {
    await Promise.all([
      this.queries.invalidateQueries({
        queryKey: deploymentKeys.runtime(sessionId, projectId),
      }),
      this.queries.invalidateQueries({
        queryKey: deploymentKeys.list(sessionId, projectId),
      }),
      this.queries.invalidateQueries({
        queryKey: deploymentKeys.history(sessionId, projectId),
      }),
      this.queries.invalidateQueries({
        queryKey: deploymentKeys.settings(sessionId, projectId),
      }),
      this.queries.invalidateQueries({
        queryKey: deploymentKeys.credentials(sessionId, projectId),
      }),
      this.queries.invalidateQueries({
        queryKey: ['deployment', sessionId, projectId],
      }),
      this.queries.invalidateQueries({
        queryKey: ['deployment-logs', sessionId, projectId],
      }),
      this.queries.invalidateQueries({
        queryKey: deploymentKeys.adminDefaults(sessionId),
      }),
    ]);
  }

  async downloadLog(
    projectId: string,
    deploymentId: string,
    source: 'proxy' | 'origin',
  ) {
    return this.http.get(
      `${environment.apiUrl}/api/deployments/${encodeURIComponent(deploymentId)}/logs`,
      { params: { projectId, source, limit: '200' }, responseType: 'text' },
    );
  }
}
