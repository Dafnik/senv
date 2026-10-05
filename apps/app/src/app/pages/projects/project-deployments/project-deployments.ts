import {
  ChangeDetectionStrategy,
  Component,
  computed,
  Signal,
  inject,
  input,
  signal,
} from '@angular/core';
import { form, FormRoot, submit } from '@angular/forms/signals';
import {
  staticArchiveExtensions,
  type PublicDeployment,
} from '@senv/api/shared/deployments';
import { ActivatedRoute, Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { DeploymentUpload } from '../../../queries/deployment-upload';
import { DeploymentsData } from '../../../queries/deployments';
import { DeploymentList } from '../deployment-list';
import { StaticSourceFields } from './publication/static-source-fields';
import { ContainerSourceFields } from './publication/container-source-fields';
import { SourceDetailsFields } from './publication/source-details-fields';
import {
  keepCapturedCredential,
  emptyPublishDraft,
  type PublishDraft,
} from './project-deployments.form';
import { PublicationDraftController } from './publication/draft-controller';
import { submitPublication } from './publication/submit-publication';
import { configurePublicationForm } from './publication/form-fields';

@Component({
  selector: 'app-project-deployments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DeploymentList,
    FormRoot,
    StaticSourceFields,
    ContainerSourceFields,
    SourceDetailsFields,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmSpinnerImports,
    HlmToggleGroupImports,
  ],
  templateUrl: './project-deployments.html',
})
export class ProjectDeployments {
  readonly projectId = input.required<string>();
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly previewSlug = input('');
  readonly redeployId = input('');
  readonly archiveAccept = staticArchiveExtensions.join(',');
  readonly keepCapturedCredential = keepCapturedCredential;
  private readonly sessionId = injectAuthSessionId();
  private readonly data = inject(DeploymentsData);
  private readonly upload = inject(DeploymentUpload);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly deployments = injectQuery(() =>
    this.data.list(this.sessionId(), this.projectId()),
  );
  readonly projectSettings = injectQuery(() =>
    this.data.settings(this.sessionId(), this.projectId()),
  );
  readonly credentials = injectQuery(() =>
    this.data.credentials(this.sessionId(), this.projectId(), this.canManage()),
  );
  readonly publishOpen = signal(false);
  readonly model = signal<PublishDraft>(emptyPublishDraft());
  readonly busy = signal(false);
  readonly uploading = signal(false);
  readonly publishForm = form(this.model, (path) =>
    configurePublicationForm(path, this.busy),
  );
  readonly formError = signal('');
  readonly draftController: PublicationDraftController;
  readonly selectedFileLabel: Signal<string>;
  readonly availableArtifacts: Signal<PublicDeployment[]>;
  readonly capturedCredentialLabel: Signal<string | undefined>;
  readonly registryCredentialSelection = computed(
    () => this.model().registryCredentialId,
  );

  constructor() {
    this.draftController = new PublicationDraftController({
      projectId: this.projectId,
      sessionId: this.sessionId,
      canManage: this.canManage,
      redeployId: this.redeployId,
      deployments: this.deployments.data,
      credentials: this.credentials.data,
      credentialsErrored: this.credentials.isError,
      model: this.model,
      publishOpen: this.publishOpen,
      route: this.route,
      router: this.router,
      clearFormError: () => this.formError.set(''),
    });
    this.selectedFileLabel = this.draftController.selectedFileLabel;
    this.availableArtifacts = this.draftController.availableArtifacts;
    this.capturedCredentialLabel = this.draftController.capturedCredentialLabel;
  }

  updateImage(event: Event) {
    this.draftController.updateImage(event);
  }

  updateRegistryCredential(event: Event) {
    this.draftController.updateRegistryCredential(event);
  }

  selectReusableContent(event: Event) {
    this.draftController.selectReusableContent(event);
  }

  setKind(
    value:
      'static' | 'container' | Array<'static' | 'container'> | null | undefined,
  ) {
    const kind = Array.isArray(value) ? value[value.length - 1] : value;
    if (!kind) return;
    this.draftController.setKind(kind);
  }
  selectArchive(event: Event) {
    this.draftController.selectArchive(event);
  }
  selectDirectory(event: Event) {
    this.draftController.selectDirectory(event);
  }
  resetDraft() {
    this.draftController.reset();
    this.publishForm().reset();
  }
  publish(event: Event) {
    event.preventDefault();
    this.formError.set('');
    void submit(this.publishForm, async () => {
      const draft = this.model();
      const projectId = this.projectId();
      const sessionId = this.sessionId();
      const reusable = this.availableArtifacts().find(
        (item) => item.id === draft.reuseDeploymentId,
      );
      const submitted = await submitPublication({
        draft,
        projectId,
        sessionId,
        currentProjectId: this.projectId,
        currentSessionId: this.sessionId,
        reusable,
        archiveFile: this.draftController.files.archiveFile(),
        directoryFiles: this.draftController.files.directoryFiles(),
        data: this.data,
        upload: this.upload,
        busy: this.busy,
        uploading: this.uploading,
        formError: this.formError,
      });
      if (submitted) {
        this.resetDraft();
        this.publishOpen.set(false);
        toast.success(
          'Deployment submitted. Its status will update as it starts.',
        );
      }
    });
  }
}
