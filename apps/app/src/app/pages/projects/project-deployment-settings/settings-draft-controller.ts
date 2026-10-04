import { effect, Signal, WritableSignal } from '@angular/core';
import type { SettingsModel } from './project-deployment-settings.model';
import { restoreSettingsModel } from './project-deployment-settings.form';

export type SettingsDraftControllerOptions = {
  projectId: Signal<string>;
  sessionId: Signal<string | null>;
  serverModel: Signal<SettingsModel | undefined>;
  model: WritableSignal<SettingsModel>;
  resetForm: () => void;
};

export class SettingsDraftController {
  private loadedProject = '';

  constructor(private readonly options: SettingsDraftControllerOptions) {
    effect(() => this.loadWhenReady());
    effect(() => this.persistChanges());
  }

  discard() {
    const serverModel = this.options.serverModel();
    if (!serverModel) return;
    localStorage.removeItem(this.key());
    this.options.model.set(serverModel);
    this.options.resetForm();
  }

  clear(projectId: string) {
    localStorage.removeItem(this.key(projectId));
  }

  private loadWhenReady() {
    const projectKey = `${this.options.sessionId()}:${this.options.projectId()}`;
    const serverModel = this.options.serverModel();
    if (!serverModel || this.loadedProject === projectKey) return;
    this.loadedProject = projectKey;
    this.options.model.set(this.loadDraft(projectKey) ?? serverModel);
  }

  private persistChanges() {
    const projectId = this.options.projectId();
    const key = this.key(projectId);
    if (
      this.loadedProject !== `${this.options.sessionId()}:${projectId}` ||
      typeof localStorage === 'undefined'
    )
      return;
    localStorage.setItem(key, JSON.stringify(this.options.model()));
  }

  private key(projectId = this.options.projectId()) {
    return `senv:deployment-settings:${this.options.sessionId()}:${projectId}`;
  }

  private loadDraft(projectKey: string) {
    if (typeof localStorage === 'undefined') return null;
    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem(`senv:deployment-settings:${projectKey}`) ??
          'null',
      );
      return restoreSettingsModel(stored, this.options.serverModel()!);
    } catch {
      return null;
    }
  }
}
