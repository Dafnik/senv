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
  validate,
} from '@angular/forms/signals';
import {
  projectRuntimeUpdateSchema,
  runtimeVariableNameSchema,
  type ProjectRuntimeUpdate,
} from '@senv/api/shared/deployments';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { DeploymentsData } from '../../../queries/deployments';

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
  template: `
    <section hlmCard id="runtime-settings" class="scroll-mt-6">
      <div hlmCardHeader>
        <h2 hlmCardTitle>Runtime configuration</h2>
        <p hlmCardDescription>
          Environment variables and secrets for this project. New deployments
          capture the saved values.
        </p>
      </div>
      <div hlmCardContent>
        @if (runtime.isPending()) {
          <hlm-spinner aria-label="Loading runtime configuration" />
        } @else if (runtime.isError()) {
          <p role="alert">{{ runtime.error().message }}</p>
          <button hlmBtn variant="outline" (click)="runtime.refetch()">
            Try again
          </button>
        } @else if (!canManage()) {
          <dl class="grid gap-4 text-sm">
            <div>
              <dt class="font-medium">Environment variables</dt>
              <dd>
                <pre class="mt-2 font-mono whitespace-pre-wrap">{{
                  envText() || 'No environment variables.'
                }}</pre>
              </dd>
            </div>
            <div>
              <dt class="font-medium">Runtime secret names</dt>
              <dd class="mt-2 font-mono">
                {{
                  runtime.data()?.secretNames?.join(', ') ||
                    'No runtime secrets.'
                }}
              </dd>
            </div>
          </dl>
          <p class="text-muted-foreground mt-4 text-sm">
            Project developers and admins can configure runtime values. Saved
            secret values stay hidden.
          </p>
        } @else {
          <form
            class="grid gap-6"
            [formRoot]="runtimeForm"
            (submit)="save($event)"
          >
            <fieldset class="grid gap-6" [disabled]="saving()">
              <div hlmField>
                <label hlmFieldLabel for="project-runtime-env"
                  >Environment variables</label
                >
                <textarea
                  hlmInput
                  id="project-runtime-env"
                  class="font-mono"
                  rows="5"
                  autocomplete="off"
                  placeholder="PUBLIC_API_URL=https://api.example.com"
                  [formField]="runtimeForm.envText"
                ></textarea>
                <p hlmFieldDescription>
                  One KEY=value pair per line. Use secrets for sensitive values.
                </p>
              </div>
              <div class="grid gap-3 border-t pt-5">
                <h3 class="font-medium">Runtime secrets</h3>
                <p class="text-muted-foreground text-sm">
                  Saved values stay hidden. Enter a value to add or replace a
                  secret. Leave existing values blank to keep them.
                </p>
                @for (
                  secret of runtimeForm.secrets;
                  track $index;
                  let index = $index
                ) {
                  <div class="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
                    <div hlmField>
                      <label
                        hlmFieldLabel
                        [for]="'project-secret-name-' + index"
                        >Secret name</label
                      >
                      <input
                        hlmInput
                        [id]="'project-secret-name-' + index"
                        [formField]="secret.name"
                        autocomplete="off"
                      />
                    </div>
                    <div hlmField>
                      <label
                        hlmFieldLabel
                        [for]="'project-secret-value-' + index"
                        >{{
                          secret.saved().value()
                            ? 'Replace value'
                            : 'Secret value'
                        }}</label
                      >
                      <input
                        hlmInput
                        type="password"
                        [id]="'project-secret-value-' + index"
                        [formField]="secret.value"
                        [placeholder]="
                          secret.saved().value() ? 'Saved value hidden' : ''
                        "
                        autocomplete="new-password"
                      />
                    </div>
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      [attr.aria-label]="
                        'Remove secret ' + secret.name().value()
                      "
                      (click)="removeSecret(index)"
                    >
                      Remove
                    </button>
                  </div>
                } @empty {
                  <p class="text-muted-foreground text-sm">
                    No runtime secrets.
                  </p>
                }
                <button
                  hlmBtn
                  variant="outline"
                  class="w-fit"
                  type="button"
                  (click)="addSecret()"
                >
                  Add secret
                </button>
              </div>
            </fieldset>
            @if (runtimeForm().touched() || runtimeForm().dirty()) {
              @for (issue of runtimeForm().errors(); track issue) {
                <hlm-field-error [validator]="issue.kind">{{
                  issue.message
                }}</hlm-field-error>
              }
            }
            @if (error()) {
              <p class="text-destructive text-sm" role="alert">{{ error() }}</p>
            }
            <div class="flex flex-wrap items-center gap-3 border-t pt-4">
              <button hlmBtn type="submit" [disabled]="saving() || !dirty()">
                @if (saving()) {
                  <hlm-spinner />
                }
                Save runtime configuration
              </button>
              <button
                hlmBtn
                type="button"
                variant="ghost"
                [disabled]="saving() || !dirty()"
                (click)="discard()"
              >
                Discard changes
              </button>
            </div>
          </form>
        }
      </div>
    </section>
  `,
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
    validate(path, ({ value }) => {
      try {
        runtimeUpdateFromDraft(value());
        return undefined;
      } catch (error) {
        return {
          kind: 'runtime',
          message:
            error instanceof Error
              ? error.message
              : 'Check runtime configuration.',
        };
      }
    });
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
          runtimeUpdateFromDraft(this.model()),
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

type RuntimeDraft = {
  envText: string;
  secrets: Array<{ name: string; value: string; saved: boolean }>;
  removedNames: string[];
};

function runtimeUpdateFromDraft(draft: RuntimeDraft): ProjectRuntimeUpdate {
  const env: Record<string, string> = Object.create(null);
  const nameSchema = runtimeVariableNameSchema;
  for (const [index, line] of draft.envText.split('\n').entries()) {
    if (!line.trim()) continue;
    const separator = line.indexOf('=');
    const name = line.slice(0, separator).trim();
    if (separator < 1 || !nameSchema.safeParse(name).success)
      throw new Error(
        `Line ${index + 1}: use KEY=value with a valid variable name.`,
      );
    if (Object.prototype.hasOwnProperty.call(env, name))
      throw new Error(`Line ${index + 1}: ${name} is repeated.`);
    env[name] = line.slice(separator + 1);
  }
  const secrets: Record<string, string> = Object.create(null);
  const names = new Set<string>();
  for (const secret of draft.secrets) {
    const name = secret.name.trim();
    if (!nameSchema.safeParse(name).success)
      throw new Error('Use a valid name for each secret.');
    if (names.has(name) || Object.prototype.hasOwnProperty.call(env, name))
      throw new Error(
        `${name} is already used by an environment variable or secret.`,
      );
    names.add(name);
    if (!secret.saved && !secret.value)
      throw new Error(`Enter a value for ${name}.`);
    if (secret.value) secrets[name] = secret.value;
  }
  const parsed = projectRuntimeUpdateSchema.safeParse({
    env,
    secrets,
    removeSecretNames: draft.removedNames,
  });
  if (!parsed.success)
    throw new Error('Runtime values cannot exceed 16384 characters.');
  return parsed.data;
}
