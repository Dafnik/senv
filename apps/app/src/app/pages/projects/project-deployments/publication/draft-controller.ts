import { computed, Signal, WritableSignal, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { canReuseDeployment } from '../../deployment-presentation';
import { DeploymentRedeployPrefill } from './redeploy-prefill';
import { PublicationDraftStorage } from './draft-storage';
import { PublicationSourceFiles } from './source-files';
import {
  emptyPublishDraft,
  keepCapturedCredential,
  type PublishDraft,
} from '../project-deployments.form';
import type { RegistryCredentialOption } from './container-source-fields';

export type PublicationDraftControllerOptions = {
  projectId: Signal<string>;
  sessionId: Signal<string | null>;
  canManage: Signal<boolean>;
  redeployId: Signal<string>;
  deployments: Signal<PublicDeployment[] | undefined>;
  credentials: Signal<RegistryCredentialOption[] | undefined>;
  credentialsErrored: Signal<boolean>;
  model: WritableSignal<PublishDraft>;
  publishOpen: WritableSignal<boolean>;
  route: ActivatedRoute;
  router: Router;
  clearFormError: () => void;
};

export class PublicationDraftController {
  readonly files = new PublicationSourceFiles();
  readonly selectedFileLabel = this.files.selectedFileLabel;
  readonly availableArtifacts = computed(() =>
    (this.options.deployments() ?? []).filter(
      (deployment) =>
        deployment.kind === this.options.model().kind &&
        canReuseDeployment(deployment),
    ),
  );
  readonly storage: PublicationDraftStorage;
  readonly capturedCredentialId = signal<string | null>(null);
  readonly capturedCredentialLabel = computed(() => {
    const id =
      this.capturedCredentialId() ??
      this.options
        .deployments()
        ?.find(
          (deployment) =>
            deployment.id === this.options.model().reuseDeploymentId,
        )?.config.registryCredentialId ??
      null;
    return this.options
      .credentials()
      ?.find((credential) => credential.id === id)?.name;
  });

  readonly redeployPrefill: DeploymentRedeployPrefill;

  constructor(private readonly options: PublicationDraftControllerOptions) {
    this.storage = new PublicationDraftStorage({
      projectId: options.projectId,
      sessionId: options.sessionId,
      model: options.model,
      prepareScopeChange: (draft) => {
        options.publishOpen.set(false);
        this.files.clear();
        this.capturedCredentialId.set(null);
        options.clearFormError();
        options.model.set(draft);
      },
    });
    this.redeployPrefill = new DeploymentRedeployPrefill({
      projectId: options.projectId,
      sessionId: options.sessionId,
      canManage: options.canManage,
      redeployId: options.redeployId,
      deployments: options.deployments,
      credentials: options.credentials,
      credentialsErrored: options.credentialsErrored,
      model: options.model,
      publishOpen: options.publishOpen,
      capturedCredentialId: this.capturedCredentialId,
      loadedDraftKey: this.storage.loadedKey,
      draftKey: () => this.storage.key(),
      route: options.route,
      router: options.router,
    });
  }

  setKind(kind: PublishDraft['kind']) {
    this.capturedCredentialId.set(null);
    this.options.model.update((draft) => ({
      ...draft,
      kind,
      registryCredentialId: '',
      reuseDeploymentId: '',
    }));
    this.files.clear();
  }

  selectArchive(event: Event) {
    this.files.selectArchive(event, () => this.clearReuseChoice());
  }

  selectDirectory(event: Event) {
    this.files.selectDirectory(event, () => this.clearReuseChoice());
  }

  selectReusableContent(event: Event) {
    const id = (event.target as HTMLSelectElement).value;
    const selected = this.options
      .deployments()
      ?.find((deployment) => deployment.id === id);
    this.capturedCredentialId.set(
      selected?.config.registryCredentialId ?? null,
    );
    this.options.model.update((draft) => ({
      ...draft,
      registryCredentialId: id ? keepCapturedCredential : '',
    }));
  }

  updateImage(event: Event) {
    const image = (event.target as HTMLInputElement).value;
    const draft = this.options.model();
    const changedSource = Boolean(draft.reuseDeploymentId);
    const capturedId =
      this.capturedCredentialId() ??
      this.options
        .deployments()
        ?.find((deployment) => deployment.id === draft.reuseDeploymentId)
        ?.config.registryCredentialId ??
      null;
    const retainCredential = Boolean(
      capturedId &&
      this.options
        .credentials()
        ?.some((credential) => credential.id === capturedId),
    );
    if (changedSource) this.capturedCredentialId.set(null);
    this.options.model.update((draft) => {
      return {
        ...draft,
        image,
        reuseDeploymentId: changedSource ? '' : draft.reuseDeploymentId,
        registryCredentialId:
          changedSource && draft.registryCredentialId === keepCapturedCredential
            ? retainCredential
              ? (capturedId ?? '')
              : ''
            : draft.registryCredentialId,
      };
    });
  }

  updateRegistryCredential(event: Event) {
    const registryCredentialId = (event.target as HTMLSelectElement).value;
    this.options.model.update((draft) => ({ ...draft, registryCredentialId }));
  }

  reset() {
    this.options.model.set(emptyPublishDraft());
    this.capturedCredentialId.set(null);
    this.files.clear();
    this.options.clearFormError();
  }

  private clearReuseChoice() {
    this.capturedCredentialId.set(null);
    this.options.model.update((draft) => ({
      ...draft,
      registryCredentialId: '',
      reuseDeploymentId: '',
    }));
  }
}
