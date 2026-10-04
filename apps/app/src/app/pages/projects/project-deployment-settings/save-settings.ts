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
};

export async function saveDeploymentSettings(
  options: SaveContext & {
    model: WritableSignal<SettingsModel>;
    data: DeploymentsData;
    saving: WritableSignal<boolean>;
    formError: WritableSignal<string>;
    clearDraft: (projectId: string) => void;
  },
) {
  options.saving.set(true);
  const projectId = options.projectId();
  const sessionId = options.sessionId();
  try {
    const settings = settingsFromModel(options.model());
    await options.data.updateSettings(projectId, settings);
    if (!isCurrent(options, projectId, sessionId)) return false;
    await options.data.invalidate(sessionId, projectId);
    options.model.set(settingsToModel(settings));
    options.clearDraft(projectId);
    options.formError.set('');
    toast.success('Project deployment defaults saved.');
    return true;
  } catch (error) {
    options.formError.set(message(error, 'Settings could not be saved.'));
    return false;
  } finally {
    options.saving.set(false);
  }
}

export async function savePreviewSlug(
  options: SaveContext & {
    model: Signal<{ previewSlug: string }>;
    projects: ProjectsData;
    router: Router;
    saving: WritableSignal<boolean>;
    error: WritableSignal<string>;
    clearDraft: () => void;
  },
) {
  options.saving.set(true);
  const projectId = options.projectId();
  const sessionId = options.sessionId();
  try {
    const changed = await options.projects.updatePreviewSlug(
      projectId,
      options.model().previewSlug.trim(),
    );
    if (!isCurrent(options, projectId, sessionId)) return false;
    options.clearDraft();
    await options.router.navigate(
      ['/projects', changed.previewSlug, 'settings'],
      { replaceUrl: true },
    );
    await options.projects.invalidate(sessionId, projectId);
    options.error.set('');
    toast.success(
      'Project slug changed. Old preview and senv links stopped working immediately.',
    );
    return true;
  } catch (error) {
    options.error.set(message(error, 'The preview slug could not be saved.'));
    return false;
  } finally {
    options.saving.set(false);
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
