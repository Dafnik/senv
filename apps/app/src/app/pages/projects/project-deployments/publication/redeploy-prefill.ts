import { effect, Signal, WritableSignal, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { canReuseDeployment } from '../../deployment-presentation';
import {
  keepCapturedCredential,
  type PublishDraft,
} from '../project-deployments.form';
import type { RegistryCredentialOption } from './container-source-fields';

type RedeployPrefillOptions = {
  projectId: Signal<string>;
  sessionId: Signal<string | null>;
  canManage: Signal<boolean>;
  redeployId: Signal<string>;
  deployments: Signal<PublicDeployment[] | undefined>;
  credentials: Signal<RegistryCredentialOption[] | undefined>;
  credentialsErrored: Signal<boolean>;
  model: WritableSignal<PublishDraft>;
  publishOpen: WritableSignal<boolean>;
  capturedCredentialId: WritableSignal<string | null>;
  loadedDraftKey: Signal<string>;
  draftKey: () => string;
  route: ActivatedRoute;
  router: Router;
};

export class DeploymentRedeployPrefill {
  private readonly handledKey = signal('');

  constructor(private readonly options: RedeployPrefillOptions) {
    effect(() => this.prefill());
  }

  private prefill() {
    const sourceId = this.options.redeployId();
    const projectId = this.options.projectId();
    const sessionId = this.options.sessionId();
    const key = `${sessionId}:${projectId}:${sourceId}`;
    if (
      !sourceId ||
      !projectId ||
      !sessionId ||
      key === this.handledKey() ||
      this.options.loadedDraftKey() !== this.options.draftKey()
    )
      return;
    const deployments = this.options.deployments();
    if (!deployments) return;
    if (!this.options.canManage()) {
      this.consumeQuery(key);
      return;
    }
    const source = deployments.find((deployment) => deployment.id === sourceId);
    if (!source || !canReuseDeployment(source)) {
      this.consumeQuery(key);
      return;
    }
    const capturedCredentialId = source.config.registryCredentialId ?? null;
    if (
      capturedCredentialId &&
      !this.options.credentials() &&
      !this.options.credentialsErrored()
    )
      return;
    this.options.capturedCredentialId.set(capturedCredentialId);
    this.options.model.update((draft) => ({
      ...draft,
      kind: source.kind,
      image:
        source.kind === 'container'
          ? (source.imageDigest ?? source.config.image ?? '')
          : '',
      registryCredentialId: keepCapturedCredential,
      pinned: source.pinned,
      commit: source.source.commit ?? '',
      branch: source.source.branch ?? '',
      port: source.config.port,
      reuseDeploymentId: source.id,
    }));
    this.options.publishOpen.set(true);
    this.consumeQuery(key);
  }

  private consumeQuery(key: string) {
    this.handledKey.set(key);
    void this.options.router.navigate([], {
      relativeTo: this.options.route,
      queryParams: { redeploy: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
