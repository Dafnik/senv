import { Injectable } from '@angular/core';
import type {
  DeploymentSettings,
  InstanceDeploymentDefaults,
  PublishDeploymentInput,
  ProjectRuntimeUpdate,
} from '@senv/api/shared/deployments';
import { injectTrpc } from '../trpc/trpc.service';

@Injectable({ providedIn: 'root' })
export class DeploymentMutations {
  protected readonly trpc = injectTrpc();

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
}
