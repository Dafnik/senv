import { Router, RouterLink } from '@angular/router';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { form, FormRoot, submit } from '@angular/forms/signals';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { DeploymentsData } from '../../../queries/deployments';
import { ProjectRuntimeSettings } from '../project-runtime-settings/project-runtime-settings';
import { ProjectRegistryCredentials } from '../project-registry-credentials/project-registry-credentials';
import { ProjectsData } from '../../../queries/projects';
import { DeploymentSettingsSourceFields } from './sections/source-fields';
import { DeploymentSettingsLimitsFields } from './sections/limits-fields';
import { DeploymentSettingsHealthFields } from './sections/health-fields';
import { DeploymentSettingsRoutesFields } from './sections/routes-fields';
import { DeploymentSettingsCacheFields } from './sections/cache-fields';
import { ProjectIdentitySettings } from './sections/identity';
import {
  createEmptySettingsModel,
  settingsToModel,
  type SettingsModel,
} from './project-deployment-settings.model';
import { SettingsDraftController } from './settings-draft-controller';
import { PreviewSlugDraft } from './preview-slug-draft';
import { SettingsEditor } from './settings-editor';
import { saveDeploymentSettings, savePreviewSlug } from './save-settings';
import {
  configureDeploymentSettingsForm,
  configurePreviewSlugForm,
} from './settings-form-fields';

@Component({
  selector: 'app-project-deployment-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ProjectRuntimeSettings,
    ProjectRegistryCredentials,
    ProjectIdentitySettings,
    DeploymentSettingsSourceFields,
    DeploymentSettingsLimitsFields,
    DeploymentSettingsHealthFields,
    DeploymentSettingsRoutesFields,
    DeploymentSettingsCacheFields,
    FormRoot,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmSpinnerImports,
  ],
  templateUrl: './project-deployment-settings.html',
})
export class ProjectDeploymentSettings {
  readonly projectId = input.required<string>();
  readonly previewSlug = input('');
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  private readonly sessionId = injectAuthSessionId();
  private readonly data = inject(DeploymentsData);
  private readonly projects = inject(ProjectsData);
  private readonly router = inject(Router);
  readonly settings = injectQuery(() =>
    this.data.settings(this.sessionId(), this.projectId()),
  );
  private readonly serverModel = computed(() => {
    const settings = this.settings.data();
    return settings ? settingsToModel(settings) : undefined;
  });
  readonly model = signal<SettingsModel>(createEmptySettingsModel());
  readonly saving = signal(false);
  readonly settingsForm = form(
    this.model,
    configureDeploymentSettingsForm(this.canManage, this.saving),
  );
  readonly slugModel = signal({ previewSlug: '' });
  readonly slugForm = form(this.slugModel, configurePreviewSlugForm());
  readonly savingSlug = signal(false);
  readonly formError = signal('');
  readonly slugError = signal('');
  private readonly editor = new SettingsEditor(this.model);
  private readonly draftController: SettingsDraftController;
  private readonly slugDraft: PreviewSlugDraft;

  constructor() {
    this.draftController = new SettingsDraftController({
      projectId: this.projectId,
      sessionId: this.sessionId,
      serverModel: this.serverModel,
      model: this.model,
      resetForm: () => this.settingsForm().reset(),
    });
    this.slugDraft = new PreviewSlugDraft(
      this.projectId,
      this.sessionId,
      this.previewSlug,
      this.slugModel,
    );
  }

  addRoute() {
    this.editor.addRoute();
  }
  removeRoute(index: number) {
    this.editor.removeRoute(index);
  }
  addCacheRule() {
    this.editor.addCacheRule();
  }
  removeCacheRule(index: number) {
    this.editor.removeCacheRule(index);
  }
  setCompression(event: Event) {
    this.editor.setCompression(event);
  }
  setCompressionEndings(event: Event) {
    this.editor.setCompressionEndings(event);
  }
  discardDraft() {
    this.draftController.discard();
  }
  async saveSettings(event: Event) {
    event.preventDefault();
    if (!this.canManage() || this.saving()) return;
    void submit(this.settingsForm, async () => {
      await saveDeploymentSettings({
        projectId: this.projectId,
        sessionId: this.sessionId,
        currentProjectId: this.projectId,
        currentSessionId: this.sessionId,
        model: this.model,
        data: this.data,
        saving: this.saving,
        formError: this.formError,
        clearDraft: (projectId) => this.draftController.clear(projectId),
      });
    });
  }
  discardSlugDraft() {
    this.slugDraft.discard(() => this.slugForm().reset());
    this.slugError.set('');
  }
  readonly routePreview = (index: number) => this.editor.routePreview(index);
  async saveSlug(event: Event) {
    event.preventDefault();
    if (!this.isAdmin() || this.savingSlug()) return;
    void submit(this.slugForm, async () => {
      await savePreviewSlug({
        projectId: this.projectId,
        sessionId: this.sessionId,
        currentProjectId: this.projectId,
        currentSessionId: this.sessionId,
        model: this.slugModel,
        projects: this.projects,
        router: this.router,
        saving: this.savingSlug,
        error: this.slugError,
        clearDraft: () => this.slugDraft.clear(),
      });
    });
  }
}
