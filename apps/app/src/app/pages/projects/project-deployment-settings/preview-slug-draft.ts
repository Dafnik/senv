import { effect, Signal, WritableSignal } from '@angular/core';
import {
  readStoredValue,
  removeStoredValue,
  removeStoredValueIfMatches,
  writeStoredValue,
} from '../../../tools/safe-storage';

export class PreviewSlugDraft {
  private loadedKey = '';

  constructor(
    private readonly projectId: Signal<string>,
    private readonly sessionId: Signal<string | null>,
    private readonly currentSlug: Signal<string>,
    private readonly model: WritableSignal<{ previewSlug: string }>,
  ) {
    effect(() => this.restore());
    effect(() => this.persist());
  }

  discard(resetForm: () => void) {
    removeStoredValue(this.key());
    this.model.set({ previewSlug: this.currentSlug() });
    resetForm();
  }

  clear(sessionId: string | null, projectId: string, snapshot: string) {
    const key = this.key(sessionId, projectId);
    removeStoredValueIfMatches(key, snapshot);
  }

  private restore() {
    const key = this.key();
    if (this.loadedKey === key) return;
    this.loadedKey = key;
    const previewSlug = readStoredValue(key) || this.currentSlug();
    this.model.set({ previewSlug });
  }

  private persist() {
    const key = this.key();
    if (this.loadedKey !== key) return;
    const slug = this.model().previewSlug;
    if (slug === this.currentSlug()) removeStoredValue(key);
    else writeStoredValue(key, slug);
  }

  private key(sessionId = this.sessionId(), projectId = this.projectId()) {
    return `senv:preview-slug:${sessionId}:${projectId}`;
  }
}
