import { inject, linkedSignal, type Signal } from '@angular/core';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { toast } from '@spartan-ng/brain/sonner';
import { injectAuthSessionId } from '../../auth/auth-client';
import { DeploymentsData } from '../../queries/deployments';

/** Creates mutation state scoped to the view's project and auth session. */
export function injectDeploymentActions(projectId: Signal<string>) {
  return new DeploymentActions(projectId);
}

export class DeploymentActions {
  private readonly sessionId = injectAuthSessionId();
  private readonly data = inject(DeploymentsData);
  readonly busy = linkedSignal(() => {
    this.projectId();
    this.sessionId();
    return false;
  });
  readonly busyId = linkedSignal(() => {
    this.projectId();
    this.sessionId();
    return '';
  });
  readonly tagDrafts = linkedSignal(() => {
    this.projectId();
    this.sessionId();
    return {} as Record<string, string>;
  });
  constructor(private readonly projectId: Signal<string>) {}
  private async withBusy(
    action: () => Promise<unknown>,
    successMessage: string,
    id = '',
  ) {
    if (this.busy() || this.busyId()) return false;
    const projectId = this.projectId();
    const sessionId = this.sessionId();
    if (id) {
      this.busyId.set(id);
    } else {
      this.busy.set(true);
    }
    try {
      await action();
      if (projectId !== this.projectId() || sessionId !== this.sessionId())
        return false;
      await this.data.invalidate(sessionId, projectId);
      if (projectId !== this.projectId() || sessionId !== this.sessionId())
        return false;
      toast.success(successMessage);
      return true;
    } catch (error) {
      if (projectId === this.projectId() && sessionId === this.sessionId()) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'The request failed. Please try again.',
        );
      }
      return false;
    } finally {
      if (projectId === this.projectId() && sessionId === this.sessionId()) {
        if (id) this.busyId.set('');
        else this.busy.set(false);
      }
    }
  }

  async setPinned(deployment: PublicDeployment) {
    await this.withBusy(
      () =>
        this.data.setPinned(
          this.projectId(),
          deployment.id,
          !deployment.pinned,
        ),
      deployment.pinned ? 'Deployment unpinned.' : 'Deployment pinned.',
      deployment.id,
    );
  }
  async act(
    deployment: PublicDeployment,
    action: 'stop' | 'restart' | 'delete',
  ) {
    if (
      action === 'delete' &&
      !window.confirm(
        `Delete deployment ${deployment.id}? Its history will remain.`,
      )
    )
      return;
    await this.withBusy(
      () =>
        action === 'stop'
          ? this.data.stop(this.projectId(), deployment.id)
          : action === 'restart'
            ? this.data.restart(this.projectId(), deployment.id)
            : this.data.remove(this.projectId(), deployment.id),
      action === 'delete'
        ? 'Deployment deleted.'
        : action === 'stop'
          ? 'Deployment stopped.'
          : 'Deployment restarted.',
      deployment.id,
    );
  }
  setTagDraft(id: string, event: Event) {
    this.tagDrafts.update((drafts) => ({
      ...drafts,
      [id]: (event.target as HTMLInputElement).value,
    }));
  }
  async assignTag(event: Event, deployment: PublicDeployment) {
    event.preventDefault();
    const tag = this.tagDrafts()[deployment.id]?.trim().toLowerCase() ?? '';
    if (!/^(?!br-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tag)) {
      toast.error(
        'Enter a lowercase DNS-safe tag. The br- prefix is reserved.',
      );
      return;
    }
    const assigned = await this.withBusy(
      () => this.data.assignTag(this.projectId(), tag, deployment.id),
      `Tag ${tag} assigned.`,
      deployment.id,
    );
    if (assigned)
      this.tagDrafts.update((drafts) => ({ ...drafts, [deployment.id]: '' }));
  }
  async removeTag(tag: string) {
    if (!window.confirm(`Remove the ${tag} preview tag?`)) return;
    await this.withBusy(
      () => this.data.removeTag(this.projectId(), tag),
      `Tag ${tag} removed.`,
    );
  }
  async forgetHistory(deploymentId: string) {
    if (!window.confirm(`Permanently remove history for ${deploymentId}?`))
      return;
    await this.withBusy(
      () => this.data.removeHistory(this.projectId(), deploymentId),
      'Deployment history removed.',
    );
  }
}
