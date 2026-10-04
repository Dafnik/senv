import { effect, Signal, WritableSignal } from '@angular/core';
import {
  settingsFromModel,
  type SettingsModel,
} from './project-deployment-settings.model';
import { restoreSettingsModel } from './project-deployment-settings.form';
import {
  readStoredValue,
  removeStoredValue,
  removeStoredValueIfMatches,
  writeStoredValue,
} from '../../../tools/safe-storage';

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
    const key = this.key(this.options.sessionId(), this.options.projectId());
    removeStoredValue(key);
    this.options.model.set(serverModel);
    this.options.resetForm();
  }

  clear(sessionId: string | null, projectId: string, snapshot: string) {
    const key = this.key(sessionId, projectId);
    removeStoredValueIfMatches(key, snapshot);
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
    const sessionId = this.options.sessionId();
    const key = this.key(sessionId, projectId);
    const model = this.options.model();
    const serverModel = this.options.serverModel();
    if (this.loadedProject !== `${sessionId}:${projectId}`) return;
    if (
      serverModel &&
      JSON.stringify(settingsFromModel(model)) ===
        JSON.stringify(settingsFromModel(serverModel))
    ) {
      removeStoredValue(key);
      return;
    }
    writeStoredValue(key, JSON.stringify(model));
  }

  private key(sessionId: string | null, projectId: string) {
    return `senv:deployment-settings:${sessionId}:${projectId}`;
  }

  private loadDraft(projectKey: string) {
    try {
      const stored: unknown = JSON.parse(
        readStoredValue(`senv:deployment-settings:${projectKey}`) ?? 'null',
      );
      return restoreSettingsModel(stored, this.options.serverModel()!);
    } catch {
      return null;
    }
  }
}
