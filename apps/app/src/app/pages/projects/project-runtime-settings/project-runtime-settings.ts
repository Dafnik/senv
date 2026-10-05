import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  applyEach,
  disabled,
  form,
  FormField,
  FormRoot,
  readonly as readOnly,
  submit,
  validateStandardSchema,
} from '@angular/forms/signals';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { DeploymentsData } from '../../../queries/deployments';
import {
  runtimeSettingsFormSchema,
  runtimeUpdateFromForm,
  type RuntimeDraft,
} from './project-runtime-settings.form';

@Component({
  selector: 'app-project-runtime-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    FormRoot,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
  ],
  templateUrl: './project-runtime-settings.html',
})
export class ProjectRuntimeSettings {
  readonly projectId = input.required<string>();
  readonly canManage = input(false);
  private readonly sessionId = injectAuthSessionId();
  private readonly data = inject(DeploymentsData);
  readonly runtime = injectQuery(() =>
    this.data.runtime(this.sessionId(), this.projectId()),
  );
  readonly model = signal<RuntimeDraft>({
    envText: '',
    secrets: [],
    removedNames: [],
  });
  readonly runtimeForm = form(this.model, (path) => {
    disabled(path, () => !this.canManage() || this.saving());
    applyEach(path.secrets, (secret) => {
      readOnly(secret.name, ({ valueOf }) => valueOf(secret.saved));
    });
    validateStandardSchema(path, runtimeSettingsFormSchema);
  });
  readonly envText = computed(() => this.model().envText);
  readonly secrets = computed(() => this.model().secrets);
  readonly removedNames = computed(() => this.model().removedNames);
  readonly saving = signal(false);
  readonly dirty = computed(() => this.runtimeForm().dirty());
  readonly error = signal('');
  private loadedKey = '';
  constructor() {
    effect(() => {
      const key = `${this.sessionId()}:${this.projectId()}`;
      if (key !== this.loadedKey) {
        this.loadedKey = key;
        this.runtimeForm().reset({
          envText: '',
          secrets: [],
          removedNames: [],
        });
        this.error.set('');
      }
      const runtime = this.runtime.data();
      if (runtime && !this.dirty()) this.load(runtime);
    });
  }
  private load(runtime: {
    env: Record<string, string>;
    secretNames: string[];
  }) {
    this.runtimeForm().reset({
      envText: Object.entries(runtime.env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      secrets: runtime.secretNames.map((name) => ({
        name,
        value: '',
        saved: true,
      })),
      removedNames: [],
    });
    this.error.set('');
  }
  discard() {
    const runtime = this.runtime.data();
    if (runtime) this.load(runtime);
  }
  addSecret() {
    this.runtimeForm().markAsDirty();
    this.model.update((draft) => ({
      ...draft,
      secrets: [...draft.secrets, { name: '', value: '', saved: false }],
    }));
  }
  removeSecret(index: number) {
    this.runtimeForm().markAsDirty();
    this.model.update((draft) => {
      const secret = draft.secrets[index];
      return {
        ...draft,
        removedNames: secret?.saved
          ? [...draft.removedNames, secret.name]
          : draft.removedNames,
        secrets: draft.secrets.filter((_, i) => i !== index),
      };
    });
  }
  async save(event: Event) {
    event.preventDefault();
    if (!this.canManage() || this.saving()) return;
    this.error.set('');
    await submit(this.runtimeForm, async () => {
      const projectId = this.projectId();
      const sessionId = this.sessionId();
      this.saving.set(true);
      try {
        const saved = await this.data.updateRuntime(
          projectId,
          runtimeUpdateFromForm(this.model()),
        );
        if (projectId !== this.projectId() || sessionId !== this.sessionId())
          return;
        this.load(saved);
        await this.data.invalidate(sessionId, projectId);
        toast.success('Project runtime configuration saved.');
      } catch (error) {
        if (projectId === this.projectId() && sessionId === this.sessionId())
          this.error.set(
            error instanceof Error
              ? error.message
              : 'Runtime configuration could not be saved.',
          );
      } finally {
        this.saving.set(false);
      }
    });
  }
}
