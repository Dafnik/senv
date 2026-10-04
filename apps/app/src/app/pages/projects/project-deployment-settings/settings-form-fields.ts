import {
  applyEach,
  MAX_LENGTH,
  MAX_NUMBER,
  MIN_NUMBER,
  PATTERN,
  REQUIRED,
  disabled,
  metadata,
  SchemaFn,
  validateStandardSchema,
} from '@angular/forms/signals';
import type { Signal } from '@angular/core';
import type { SettingsModel } from './project-deployment-settings.model';
import {
  projectDeploymentSettingsFormSchema,
  projectPreviewSlugFormSchema,
} from './project-deployment-settings.form';

export function configureDeploymentSettingsForm(
  canManage: Signal<boolean>,
  saving: Signal<boolean>,
): SchemaFn<SettingsModel> {
  return (path) => {
    disabled(path.spaFallback, () => !canManage() || saving());
    metadata(path.retentionDays, MIN_NUMBER, () => 1);
    metadata(path.retentionDays, MAX_NUMBER, () => 3650);
    metadata(path.originMemoryMiB, MIN_NUMBER, () => 16);
    metadata(path.originMemoryMiB, MAX_NUMBER, () => 1048576);
    metadata(
      path.originCpus,
      PATTERN,
      () => /^(?:0\.0*[1-9]\d{0,2}|[1-9]\d{0,2}(?:\.\d{1,3})?)$/,
    );
    metadata(path.health.path, REQUIRED, () => true);
    metadata(path.health.startupDeadlineSeconds, MIN_NUMBER, () => 5);
    metadata(path.health.startupDeadlineSeconds, MAX_NUMBER, () => 3600);
    metadata(path.health.intervalSeconds, MIN_NUMBER, () => 1);
    metadata(path.health.intervalSeconds, MAX_NUMBER, () => 300);
    metadata(path.health.timeoutSeconds, MIN_NUMBER, () => 1);
    metadata(path.health.timeoutSeconds, MAX_NUMBER, () => 60);
    metadata(path.health.unhealthyThreshold, MIN_NUMBER, () => 1);
    metadata(path.health.unhealthyThreshold, MAX_NUMBER, () => 20);
    applyEach(path.proxy.routes, (route) => {
      metadata(route.path, REQUIRED, () => true);
      metadata(route.target, REQUIRED, () => true);
      metadata(route.connectTimeoutSeconds, MIN_NUMBER, () => 1);
      metadata(route.connectTimeoutSeconds, MAX_NUMBER, () => 300);
      metadata(route.readTimeoutSeconds, MIN_NUMBER, () => 1);
      metadata(route.readTimeoutSeconds, MAX_NUMBER, () => 3600);
    });
    applyEach(path.proxy.cacheRules, (rule) => {
      metadata(rule.value, REQUIRED, () => true);
      metadata(rule.durationSeconds, MIN_NUMBER, () => 1);
      metadata(rule.durationSeconds, MAX_NUMBER, () => 604800);
    });
    validateStandardSchema(path, projectDeploymentSettingsFormSchema);
  };
}

export function configurePreviewSlugForm(
  saving: Signal<boolean>,
): SchemaFn<{ previewSlug: string }> {
  return (path) => {
    disabled(path, () => saving());
    metadata(path.previewSlug, REQUIRED, () => true);
    metadata(path.previewSlug, MAX_LENGTH, () => 63);
    metadata(
      path.previewSlug,
      PATTERN,
      () => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    );
    validateStandardSchema(path, projectPreviewSlugFormSchema);
  };
}
