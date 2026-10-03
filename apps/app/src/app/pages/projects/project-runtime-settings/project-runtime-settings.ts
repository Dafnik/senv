import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
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
        @if (!canManage()) {
          <p class="text-muted-foreground text-sm">
            Project developers and admins can configure runtime values.
          </p>
        } @else if (runtime.isPending()) {
          <hlm-spinner aria-label="Loading runtime configuration" />
        } @else if (runtime.isError()) {
          <p role="alert">{{ runtime.error().message }}</p>
          <button hlmBtn variant="outline" (click)="runtime.refetch()">
            Try again
          </button>
        } @else {
          <form class="grid gap-6" (submit)="save($event)">
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
                  [value]="envText()"
                  (input)="setEnv($event)"
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
                @for (secret of secrets(); track $index; let index = $index) {
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
                        [value]="secret.name"
                        [readOnly]="secret.saved"
                        autocomplete="off"
                        (input)="editSecret(index, 'name', $event)"
                      />
                    </div>
                    <div hlmField>
                      <label
                        hlmFieldLabel
                        [for]="'project-secret-value-' + index"
                        >{{
                          secret.saved ? 'Replace value' : 'Secret value'
                        }}</label
                      >
                      <input
                        hlmInput
                        type="password"
                        [id]="'project-secret-value-' + index"
                        [value]="secret.value"
                        [placeholder]="secret.saved ? 'Saved value hidden' : ''"
                        autocomplete="new-password"
                        (input)="editSecret(index, 'value', $event)"
                      />
                    </div>
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      [attr.aria-label]="'Remove secret ' + secret.name"
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
    this.data.runtime(this.sessionId(), this.projectId(), this.canManage()),
  );
  readonly envText = signal('');
  readonly secrets = signal<
    Array<{ name: string; value: string; saved: boolean }>
  >([]);
  readonly removedNames = signal<string[]>([]);
  readonly saving = signal(false);
  readonly dirty = signal(false);
  readonly error = signal('');
  private loadedKey = '';
  constructor() {
    effect(() => {
      const key = `${this.sessionId()}:${this.projectId()}`;
      if (key !== this.loadedKey) {
        this.loadedKey = key;
        this.envText.set('');
        this.secrets.set([]);
        this.removedNames.set([]);
        this.dirty.set(false);
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
    this.envText.set(
      Object.entries(runtime.env)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
    );
    this.secrets.set(
      runtime.secretNames.map((name) => ({ name, value: '', saved: true })),
    );
    this.removedNames.set([]);
    this.error.set('');
    this.dirty.set(false);
  }
  discard() {
    const runtime = this.runtime.data();
    if (runtime) this.load(runtime);
  }
  setEnv(event: Event) {
    this.dirty.set(true);
    this.envText.set((event.target as HTMLTextAreaElement).value);
  }
  addSecret() {
    this.dirty.set(true);
    this.secrets.update((items) => [
      ...items,
      { name: '', value: '', saved: false },
    ]);
  }
  editSecret(index: number, field: 'name' | 'value', event: Event) {
    this.dirty.set(true);
    const value = (event.target as HTMLInputElement).value;
    this.secrets.update((items) =>
      items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  }
  removeSecret(index: number) {
    this.dirty.set(true);
    const secret = this.secrets()[index];
    if (secret?.saved)
      this.removedNames.update((names) => [...names, secret.name]);
    this.secrets.update((items) => items.filter((_, i) => i !== index));
  }
  private parseEnv() {
    const env: Record<string, string> = Object.create(null);
    for (const [index, line] of this.envText().split('\n').entries()) {
      if (!line.trim()) continue;
      const separator = line.indexOf('=');
      const name = line.slice(0, separator).trim();
      if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new Error(
          `Line ${index + 1}: use KEY=value with a valid variable name.`,
        );
      if (Object.prototype.hasOwnProperty.call(env, name))
        throw new Error(`Line ${index + 1}: ${name} is repeated.`);
      env[name] = line.slice(separator + 1);
    }
    return env;
  }
  async save(event: Event) {
    event.preventDefault();
    if (!this.canManage() || this.saving()) return;
    const projectId = this.projectId();
    const sessionId = this.sessionId();
    this.saving.set(true);
    try {
      const env = this.parseEnv();
      const secrets: Record<string, string> = Object.create(null);
      const names = new Set<string>();
      for (const secret of this.secrets()) {
        const name = secret.name.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
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
      const saved = await this.data.updateRuntime(projectId, {
        env,
        secrets,
        removeSecretNames: this.removedNames(),
      });
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
  }
}
