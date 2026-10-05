import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
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
  registryCredentialFormSchema,
  toRegistryCredentialInput,
  type RegistryCredentialDraft,
} from './project-registry-credentials.form';

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
  templateUrl: './project-registry-credentials.html',
})
export class ProjectRegistryCredentials {
  readonly projectId = input.required<string>();
  readonly canManage = input(false);
  private readonly sessionId = injectAuthSessionId();
  private readonly scopeIdentity = computed(() => ({
    projectId: this.projectId(),
    sessionId: this.sessionId(),
  }));
  private readonly data = inject(DeploymentsData);
  readonly credentials = injectQuery(() =>
    this.data.credentials(this.sessionId(), this.projectId(), this.canManage()),
  );
  readonly credentialBusy = linkedSignal(() => {
    this.projectId();
    this.sessionId();
    return false;
  });
  private readonly operation = signal(0);
  readonly credentialModel = signal<RegistryCredentialDraft>({
    name: '',
    registry: '',
    username: '',
    secret: '',
  });
  readonly credentialForm = form(
    this.credentialModel,
    registryCredentialFormSchema,
  );

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
      const projectId = this.projectId();
      const sessionId = this.sessionId();
      const scopeIdentity = this.scopeIdentity();
      const operation = this.operation() + 1;
      this.operation.set(operation);
      const ownsView = () =>
        operation === this.operation() &&
        scopeIdentity === this.scopeIdentity() &&
        projectId === this.projectId() &&
        sessionId === this.sessionId();
      this.credentialBusy.set(true);
      try {
        const value = toRegistryCredentialInput(this.credentialModel());
        await this.data.saveRegistryCredential({
          projectId,
          ...value,
        });
        await this.data.invalidate(sessionId, projectId);
        if (!ownsView()) return;
        this.credentialModel.set({
          name: '',
          registry: '',
          username: '',
          secret: '',
        });
        this.credentialForm().reset();
        toast.success('Registry credential saved.');
      } catch (error) {
        if (ownsView())
          toast.error(
            error instanceof Error
              ? error.message
              : 'Could not save the credential.',
          );
      } finally {
        if (ownsView()) this.credentialBusy.set(false);
      }
    });
  }
  async deleteCredential(credentialId: string, name: string) {
    if (!window.confirm(`Remove registry credential “${name}”?`)) return;
    if (!this.canManage() || this.credentialBusy()) return;
    const projectId = this.projectId();
    const sessionId = this.sessionId();
    const scopeIdentity = this.scopeIdentity();
    const operation = this.operation() + 1;
    this.operation.set(operation);
    const ownsView = () =>
      operation === this.operation() &&
      scopeIdentity === this.scopeIdentity() &&
      projectId === this.projectId() &&
      sessionId === this.sessionId();
    this.credentialBusy.set(true);
    try {
      await this.data.deleteRegistryCredential(projectId, credentialId);
      await this.data.invalidate(sessionId, projectId);
      if (!ownsView()) return;
      toast.success('Registry credential removed.');
    } catch (error) {
      if (ownsView())
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not remove the credential.',
        );
    } finally {
      if (ownsView()) this.credentialBusy.set(false);
    }
  }
}
