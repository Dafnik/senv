import { computed, linkedSignal, signal } from '@angular/core';
import { expect, test, vi } from 'vite-plus/test';
import { createEmptySettingsModel } from './project-deployment-settings.model';
import { saveDeploymentSettings } from './save-settings';

test('a late settings invalidation keeps the new scope model and clears only the captured draft', async () => {
  let release!: () => void;
  const invalidation = new Promise<void>((resolve) => (release = resolve));
  const projectId = signal('old-project');
  const sessionId = signal<string | null>('old-session');
  const model = signal(createEmptySettingsModel());
  const draftSnapshot = JSON.stringify(model());
  const nextModel = createEmptySettingsModel();
  nextModel.repository = 'new-scope';
  const saving = linkedSignal(() => {
    projectId();
    sessionId();
    return false;
  });
  const scopeIdentity = computed(() => ({
    projectId: projectId(),
    sessionId: sessionId(),
  }));
  const clearDraft = vi.fn();
  const data = {
    updateSettings: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn(() => invalidation),
  };
  const save = saveDeploymentSettings({
    projectId,
    sessionId,
    currentProjectId: projectId,
    currentSessionId: sessionId,
    operation: signal(0),
    scopeIdentity,
    model,
    data: data as never,
    saving,
    formError: signal(''),
    clearDraft,
  });

  await vi.waitFor(() =>
    expect(data.invalidate).toHaveBeenCalledWith('old-session', 'old-project'),
  );
  projectId.set('new-project');
  sessionId.set('new-session');
  expect(saving()).toBe(false);
  projectId.set('old-project');
  sessionId.set('old-session');
  model.set(nextModel);
  expect(saving()).toBe(false);
  release();
  await expect(save).resolves.toBe(false);
  expect(model()).toBe(nextModel);
  expect(clearDraft).toHaveBeenCalledOnce();
  expect(clearDraft).toHaveBeenCalledWith(
    'old-session',
    'old-project',
    draftSnapshot,
  );
});
