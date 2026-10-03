import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  FormRoot,
  required,
  submit,
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

@Component({
  selector: 'app-project-registry-credentials',
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
    <section hlmCard id="registry-settings" class="scroll-mt-6">
      <div hlmCardHeader>
        <h2 hlmCardTitle>Registry credentials</h2>
        <p hlmCardDescription>
          Project developers and admins can reuse credentials for private
          container images. Secret values are never shown again.
        </p>
      </div>
      <div hlmCardContent class="grid gap-4">
        @if (!canManage()) {
          <p class="text-muted-foreground text-sm">
            Project developers and admins can manage registry credentials.
          </p>
        } @else if (credentials.isPending()) {
          <hlm-spinner aria-label="Loading registry credentials" />
        } @else if (credentials.isError()) {
          <p role="alert">{{ credentials.error().message }}</p>
        } @else if (credentials.data()?.length) {
          @for (credential of credentials.data() ?? []; track credential.id) {
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t py-3 text-sm"
            >
              <div>
                <span class="font-medium">{{ credential.name }}</span
                ><span class="text-muted-foreground">
                  · {{ credential.registry }} · {{ credential.username }}</span
                >
              </div>
              @if (canManage()) {
                <button
                  hlmBtn
                  size="sm"
                  variant="destructive"
                  (click)="deleteCredential(credential.id, credential.name)"
                >
                  Remove
                </button>
              }
            </div>
          }
        } @else {
          <p class="text-muted-foreground text-sm">
            No saved registry credentials.
          </p>
        }
        @if (canManage()) {
          <form
            class="grid gap-4 border-t pt-4"
            [formRoot]="credentialForm"
            (submit)="saveCredential($event)"
          >
            <h3 class="font-medium">Add credential</h3>
            <div class="grid gap-4 sm:grid-cols-2">
              <div hlmField>
                <label hlmFieldLabel for="credential-name">Name</label
                ><input
                  hlmInput
                  id="credential-name"
                  autocomplete="off"
                  [formField]="credentialForm.name"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="credential-registry"
                  >Registry host</label
                ><input
                  hlmInput
                  id="credential-registry"
                  placeholder="ghcr.io"
                  autocomplete="url"
                  [formField]="credentialForm.registry"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="credential-username">Username</label
                ><input
                  hlmInput
                  id="credential-username"
                  autocomplete="username"
                  [formField]="credentialForm.username"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="credential-secret"
                  >Access token or password</label
                ><input
                  hlmInput
                  id="credential-secret"
                  type="password"
                  autocomplete="new-password"
                  [formField]="credentialForm.secret"
                />
              </div>
            </div>
            <p class="text-muted-foreground text-sm">
              senv stores this value for pulls and never includes it in API
              responses or configuration summaries.
            </p>
            <button
              hlmBtn
              type="submit"
              [disabled]="credentialBusy() || credentialForm().invalid()"
            >
              @if (credentialBusy()) {
                <hlm-spinner />
              }
              Save credential
            </button>
          </form>
        }
      </div>
    </section>
  `,
})
export class ProjectRegistryCredentials {
  readonly projectId = input.required<string>();
  readonly canManage = input(false);
  private readonly sessionId = injectAuthSessionId();
  private readonly data = inject(DeploymentsData);
  readonly credentials = injectQuery(() =>
    this.data.credentials(this.sessionId(), this.projectId(), this.canManage()),
  );
  readonly credentialBusy = signal(false);
  readonly credentialModel = signal({
    name: '',
    registry: '',
    username: '',
    secret: '',
  });
  readonly credentialForm = form(this.credentialModel, (path) => {
    required(path.name, { message: 'Enter a name for this credential.' });
    required(path.registry, { message: 'Enter a registry host.' });
    required(path.username, { message: 'Enter a registry username.' });
    required(path.secret, {
      message: 'Enter the registry access token or password.',
    });
  });

  constructor() {
    effect(() => {
      this.projectId();
      this.sessionId();
      this.credentialModel.set({
        name: '',
        registry: '',
        username: '',
        secret: '',
      });
      this.credentialForm().reset();
    });
  }
  async saveCredential(event: Event) {
    event.preventDefault();
    if (!this.canManage() || this.credentialBusy()) return;
    void submit(this.credentialForm, async () => {
      this.credentialBusy.set(true);
      const projectId = this.projectId();
      const sessionId = this.sessionId();
      try {
        const value = this.credentialModel();
        await this.data.saveRegistryCredential({
          projectId,
          name: value.name.trim(),
          registry: value.registry.trim(),
          username: value.username.trim(),
          secret: value.secret,
        });
        if (projectId !== this.projectId() || sessionId !== this.sessionId())
          return;
        this.credentialModel.set({
          name: '',
          registry: '',
          username: '',
          secret: '',
        });
        this.credentialForm().reset();
        await this.data.invalidate(sessionId, projectId);
        toast.success('Registry credential saved.');
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not save the credential.',
        );
      } finally {
        this.credentialBusy.set(false);
      }
    });
  }
  async deleteCredential(credentialId: string, name: string) {
    if (!window.confirm(`Remove registry credential “${name}”?`)) return;
    if (!this.canManage() || this.credentialBusy()) return;
    this.credentialBusy.set(true);
    const projectId = this.projectId();
    const sessionId = this.sessionId();
    try {
      await this.data.deleteRegistryCredential(projectId, credentialId);
      await this.data.invalidate(sessionId, projectId);
      toast.success('Registry credential removed.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not remove the credential.',
      );
    } finally {
      this.credentialBusy.set(false);
    }
  }
}
