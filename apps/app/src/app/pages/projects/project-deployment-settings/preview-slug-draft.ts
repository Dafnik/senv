import { effect, Signal, WritableSignal } from '@angular/core';

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
    if (typeof localStorage !== 'undefined')
      localStorage.removeItem(this.key());
    this.model.set({ previewSlug: this.currentSlug() });
    resetForm();
  }

  clear() {
    if (typeof localStorage !== 'undefined')
      localStorage.removeItem(this.key());
  }

  private restore() {
    const key = this.key();
    if (this.loadedKey === key) return;
    this.loadedKey = key;
    let previewSlug = this.currentSlug();
    if (typeof localStorage !== 'undefined') {
      try {
        previewSlug = localStorage.getItem(key) || previewSlug;
      } catch {
        // The route slug remains a usable fallback when storage is unavailable.
      }
    }
    this.model.set({ previewSlug });
  }

  private persist() {
    const key = this.key();
    if (this.loadedKey !== key || typeof localStorage === 'undefined') return;
    const slug = this.model().previewSlug;
    if (slug === this.currentSlug()) localStorage.removeItem(key);
    else localStorage.setItem(key, slug);
  }

  private key() {
    return `senv:preview-slug:${this.sessionId()}:${this.projectId()}`;
  }
}
