import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
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
  private readonly data = inject(DeploymentsData);
  readonly credentials = injectQuery(() =>
    this.data.credentials(this.sessionId(), this.projectId(), this.canManage()),
  );
  readonly credentialBusy = signal(false);
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
      this.credentialBusy.set(true);
      const projectId = this.projectId();
      const sessionId = this.sessionId();
      try {
        const value = toRegistryCredentialInput(this.credentialModel());
        await this.data.saveRegistryCredential({
          projectId,
          ...value,
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
