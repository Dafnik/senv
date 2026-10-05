import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
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
  adminDeploymentDefaultsFormSchema,
  toInstanceDeploymentDefaults,
  type AdminDeploymentDefaultsDraft,
} from './admin-deployment-defaults.form';

@Component({
  selector: 'app-admin-deployment-defaults',
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
  templateUrl: './admin-deployment-defaults.html',
})
export class AdminDeploymentDefaults {
  private readonly sessionId = injectAuthSessionId();
  private readonly data = inject(DeploymentsData);
  readonly adminDefaults = injectQuery(() =>
    this.data.adminDefaults(this.sessionId()),
  );
  readonly savingDefaults = signal(false);
  private loadedDefaults: string | null = null;
  readonly defaultsModel = signal<AdminDeploymentDefaultsDraft>({
    uploadLimitMiB: 100,
    proxyCpus: '0.1',
    proxyMemoryMiB: 64,
    logFiles: 3,
    logFileSizeMiB: 10,
  });
  readonly defaultsForm = form(
    this.defaultsModel,
    adminDeploymentDefaultsFormSchema,
  );
  constructor() {
    effect(() => {
      const value = this.adminDefaults.data();
      const sessionId = this.sessionId();
      if (!value || this.loadedDefaults === sessionId) return;
      this.loadedDefaults = sessionId;
      this.defaultsModel.set({
        uploadLimitMiB: value.uploadLimitBytes / 1048576,
        proxyCpus: value.proxyCpus,
        proxyMemoryMiB: value.proxyMemoryBytes / 1048576,
        logFiles: value.logFiles,
        logFileSizeMiB: value.logFileSizeBytes / 1048576,
      });
    });
  }
  async saveDefaults(event: Event) {
    event.preventDefault();
    if (this.savingDefaults()) return;
    void submit(this.defaultsForm, async () => {
      this.savingDefaults.set(true);
      try {
        const defaults = toInstanceDeploymentDefaults(this.defaultsModel());
        await this.data.updateAdminDefaults(defaults);
        this.adminDefaults.refetch();
        toast.success('Instance deployment defaults saved.');
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Instance defaults could not be saved.',
        );
      } finally {
        this.savingDefaults.set(false);
      }
    });
  }
}
