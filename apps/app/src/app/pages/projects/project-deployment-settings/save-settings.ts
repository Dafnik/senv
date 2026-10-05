import { Signal, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import type { DeploymentsData } from '../../../queries/deployments';
import type { ProjectsData } from '../../../queries/projects';
import {
  settingsFromModel,
  settingsToModel,
  type SettingsModel,
} from './project-deployment-settings.model';

type SaveContext = {
  projectId: Signal<string>;
  sessionId: Signal<string | null>;
  currentProjectId: Signal<string>;
  currentSessionId: Signal<string | null>;
  operation: WritableSignal<number>;
  scopeIdentity: Signal<object>;
};

export async function saveDeploymentSettings(
  options: SaveContext & {
    model: WritableSignal<SettingsModel>;
    data: DeploymentsData;
    saving: WritableSignal<boolean>;
    formError: WritableSignal<string>;
    clearDraft: (
      sessionId: string | null,
      projectId: string,
      snapshot: string,
    ) => void;
  },
) {
  const projectId = options.projectId();
  const sessionId = options.sessionId();
  const scopeIdentity = options.scopeIdentity();
  const draftSnapshot = JSON.stringify(options.model());
  const operation = options.operation() + 1;
  options.operation.set(operation);
  const ownsView = () =>
    operation === options.operation() &&
    options.scopeIdentity() === scopeIdentity &&
    isCurrent(options, projectId, sessionId);
  options.saving.set(true);
  try {
    const settings = settingsFromModel(options.model());
    await options.data.updateSettings(projectId, settings);
    options.clearDraft(sessionId, projectId, draftSnapshot);
    await options.data.invalidate(sessionId, projectId);
    if (!ownsView()) return false;
    options.model.set(settingsToModel(settings));
    options.formError.set('');
    toast.success('Project deployment defaults saved.');
    return true;
  } catch (error) {
    if (ownsView())
      options.formError.set(message(error, 'Settings could not be saved.'));
    return false;
  } finally {
    if (ownsView()) options.saving.set(false);
  }
}

export async function savePreviewSlug(
  options: SaveContext & {
    model: Signal<{ previewSlug: string }>;
    projects: ProjectsData;
    router: Router;
    saving: WritableSignal<boolean>;
    error: WritableSignal<string>;
    clearDraft: (
      sessionId: string | null,
      projectId: string,
      snapshot: string,
    ) => void;
  },
) {
  const projectId = options.projectId();
  const sessionId = options.sessionId();
  const scopeIdentity = options.scopeIdentity();
  const draftSnapshot = options.model().previewSlug;
  const operation = options.operation() + 1;
  options.operation.set(operation);
  const ownsView = () =>
    operation === options.operation() &&
    options.scopeIdentity() === scopeIdentity &&
    isCurrent(options, projectId, sessionId);
  options.saving.set(true);
  try {
    const changed = await options.projects.updatePreviewSlug(
      projectId,
      options.model().previewSlug.trim(),
    );
    options.clearDraft(sessionId, projectId, draftSnapshot);
    await options.projects.invalidate(sessionId, projectId);
    if (!ownsView()) return false;
    await options.router.navigate(
      ['/projects', changed.previewSlug, 'settings'],
      { replaceUrl: true },
    );
    if (!ownsView()) return false;
    options.error.set('');
    toast.success(
      'Project slug changed. Old preview and senv links stopped working immediately.',
    );
    return true;
  } catch (error) {
    if (ownsView())
      options.error.set(message(error, 'The preview slug could not be saved.'));
    return false;
  } finally {
    if (ownsView()) options.saving.set(false);
  }
}

function isCurrent(
  options: SaveContext,
  projectId: string,
  sessionId: string | null,
) {
  return (
    projectId === options.currentProjectId() &&
    sessionId === options.currentSessionId()
  );
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
