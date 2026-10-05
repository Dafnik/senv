import { inject, Injectable } from '@angular/core';
import { DeploymentQueries } from './deployment-queries';
import { DeploymentMutations } from './deployment-mutations';
import { QueryClient } from '@tanstack/angular-query';

export { deploymentKeys } from './deployment-keys';
import { deploymentKeys } from './deployment-keys';
import { artifactKeys } from './artifacts';

@Injectable({ providedIn: 'root' })
export class DeploymentsData {
  private readonly queries = inject(DeploymentQueries);
  private readonly mutations = inject(DeploymentMutations);
  private readonly queryClient = inject(QueryClient);

  readonly list = this.queries.list.bind(this.queries);
  readonly detail = this.queries.detail.bind(this.queries);
  readonly history = this.queries.history.bind(this.queries);
  readonly previewStatus = this.queries.previewStatus.bind(this.queries);
  readonly logs = this.queries.logs.bind(this.queries);
  readonly resourceHistory = this.queries.resourceHistory.bind(this.queries);
  readonly resources = this.queries.resources.bind(this.queries);
  readonly settings = this.queries.settings.bind(this.queries);
  readonly runtime = this.queries.runtime.bind(this.queries);
  readonly credentials = this.queries.credentials.bind(this.queries);
  readonly adminDefaults = this.queries.adminDefaults.bind(this.queries);

  readonly publish = this.mutations.publish.bind(this.mutations);
  readonly stop = this.mutations.stop.bind(this.mutations);
  readonly restart = this.mutations.restart.bind(this.mutations);
  readonly remove = this.mutations.remove.bind(this.mutations);
  readonly assignTag = this.mutations.assignTag.bind(this.mutations);
  readonly removeTag = this.mutations.removeTag.bind(this.mutations);
  readonly removeHistory = this.mutations.removeHistory.bind(this.mutations);
  readonly updateSettings = this.mutations.updateSettings.bind(this.mutations);
  readonly setPinned = this.mutations.setPinned.bind(this.mutations);
  readonly saveRegistryCredential = this.mutations.saveRegistryCredential.bind(
    this.mutations,
  );
  readonly deleteRegistryCredential =
    this.mutations.deleteRegistryCredential.bind(this.mutations);
  readonly updateAdminDefaults = this.mutations.updateAdminDefaults.bind(
    this.mutations,
  );
  readonly updateRuntime = this.mutations.updateRuntime.bind(this.mutations);

  async invalidate(sessionId: string | null, projectId: string) {
    await Promise.all([
      this.queryClient.invalidateQueries({
        queryKey: artifactKeys(sessionId, projectId),
      }),
      this.queryClient.invalidateQueries({
        queryKey: deploymentKeys.runtime(sessionId, projectId),
      }),
      this.queryClient.invalidateQueries({
        queryKey: deploymentKeys.list(sessionId, projectId),
      }),
      this.queryClient.invalidateQueries({
        queryKey: deploymentKeys.historyPrefix(sessionId, projectId),
      }),
      this.queryClient.invalidateQueries({
        queryKey: deploymentKeys.settings(sessionId, projectId),
      }),
      this.queryClient.invalidateQueries({
        queryKey: deploymentKeys.credentials(sessionId, projectId),
      }),
      this.queryClient.invalidateQueries({
        queryKey: deploymentKeys.detailPrefix(sessionId, projectId),
      }),
      this.queryClient.invalidateQueries({
        queryKey: deploymentKeys.previewStatusPrefix(sessionId, projectId),
      }),
      this.queryClient.invalidateQueries({
        queryKey: deploymentKeys.logsPrefix(sessionId, projectId),
      }),
      this.queryClient.invalidateQueries({
        queryKey: deploymentKeys.adminDefaults(sessionId),
      }),
    ]);
  }
}
