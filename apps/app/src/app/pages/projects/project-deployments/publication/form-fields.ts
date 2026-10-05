import {
  MAX_LENGTH,
  MAX_NUMBER,
  MIN_NUMBER,
  REQUIRED,
  SchemaPathTree,
  disabled,
  metadata,
  validateStandardSchema,
} from '@angular/forms/signals';
import type { Signal } from '@angular/core';
import {
  publishDraftSchema,
  type PublishDraft,
} from '../project-deployments.form';

export function configurePublicationForm(
  path: SchemaPathTree<PublishDraft>,
  busy: Signal<boolean>,
) {
  disabled(path, () => busy());
  disabled(path.image, () => busy());
  metadata(
    path.image,
    REQUIRED,
    ({ valueOf }) =>
      valueOf(path.kind) === 'container' && !valueOf(path.reuseDeploymentId),
  );
  metadata(path.image, MAX_LENGTH, () => 2048);
  metadata(path.port, MIN_NUMBER, () => 1);
  metadata(path.port, MAX_NUMBER, () => 65535);
  metadata(path.commit, MAX_LENGTH, () => 256);
  metadata(path.branch, MAX_LENGTH, () => 512);
  validateStandardSchema(path, publishDraftSchema);
}
