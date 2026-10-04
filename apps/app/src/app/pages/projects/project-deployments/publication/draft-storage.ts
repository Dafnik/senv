import { effect, Signal, signal, WritableSignal } from '@angular/core';
import {
  readStoredValue,
  writeStoredValue,
} from '../../../../tools/safe-storage';
import {
  emptyPublishDraft,
  restorePublishDraft,
  type PublishDraft,
} from '../project-deployments.form';

export type PublicationDraftStorageOptions = {
  projectId: Signal<string>;
  sessionId: Signal<string | null>;
  model: WritableSignal<PublishDraft>;
  prepareScopeChange: (draft: PublishDraft) => void;
};

export class PublicationDraftStorage {
  readonly loadedKey = signal('');

  constructor(private readonly options: PublicationDraftStorageOptions) {
    effect(() => this.loadAndPersist());
  }

  key() {
    return `senv:deployment-draft:${this.options.sessionId()}:${this.options.projectId()}`;
  }

  private loadAndPersist() {
    const key = this.key();
    if (this.loadedKey() !== key) {
      this.options.prepareScopeChange(this.load(key));
      this.loadedKey.set(key);
      return;
    }
    writeStoredValue(key, JSON.stringify(this.options.model()));
  }

  private load(key: string): PublishDraft {
    try {
      const stored: unknown = JSON.parse(readStoredValue(key) ?? 'null');
      return restorePublishDraft(stored, emptyPublishDraft());
    } catch {
      return emptyPublishDraft();
    }
  }
}
