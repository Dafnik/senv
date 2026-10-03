import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  FormRoot,
  min,
  max,
  pattern,
  validate,
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
import type { InstanceDeploymentDefaults } from '@senv/api/shared/deployments';
type AdminDefaultsModel = {
  uploadLimitMiB: number;
  proxyCpus: string;
  proxyMemoryMiB: number;
  logFiles: number;
  logFileSizeMiB: number;
};

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
  template: `<div class="mx-auto grid w-full max-w-5xl gap-8 p-4 md:p-8">
    <header>
      <h1 class="text-3xl font-semibold tracking-tight">Deployment defaults</h1>
      <p class="text-muted-foreground mt-2">
        Instance limits for uploads, proxy resources, and logs.
      </p>
    </header>
    <section hlmCard>
      <div hlmCardHeader>
        <h2 hlmCardTitle>Instance deployment defaults</h2>
        <p hlmCardDescription>
          These limits apply to future uploads, proxy containers, and deployment
          logs.
        </p>
      </div>
      @if (adminDefaults.isPending()) {
        <div hlmCardContent>
          <hlm-spinner aria-label="Loading instance defaults" />
        </div>
      } @else if (adminDefaults.isError()) {
        <div hlmCardContent>
          <p role="alert">{{ adminDefaults.error().message }}</p>
        </div>
      } @else {
        <form
          hlmCardContent
          class="grid gap-4"
          [formRoot]="defaultsForm"
          (submit)="saveDefaults($event)"
        >
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div hlmField>
              <label hlmFieldLabel for="upload-limit"
                >Maximum upload size (MiB)</label
              ><input
                hlmInput
                id="upload-limit"
                type="number"
                [formField]="defaultsForm.uploadLimitMiB"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="proxy-cpus"
                >Proxy CPU cores per deployment</label
              ><input
                hlmInput
                id="proxy-cpus"
                inputmode="decimal"
                [formField]="defaultsForm.proxyCpus"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="proxy-memory">Proxy memory (MiB)</label
              ><input
                hlmInput
                id="proxy-memory"
                type="number"
                [formField]="defaultsForm.proxyMemoryMiB"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="log-files"
                >Rotated log files per container</label
              ><input
                hlmInput
                id="log-files"
                type="number"
                [formField]="defaultsForm.logFiles"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="log-file-size"
                >Size of each log file (MiB)</label
              ><input
                hlmInput
                id="log-file-size"
                type="number"
                [formField]="defaultsForm.logFileSizeMiB"
              />
            </div>
          </div>
          <button
            hlmBtn
            type="submit"
            [disabled]="savingDefaults() || defaultsForm().invalid()"
          >
            @if (savingDefaults()) {
              <hlm-spinner />
            }
            Save instance defaults
          </button>
        </form>
      }
    </section>
  </div>`,
})
export class AdminDeploymentDefaults {
  private readonly sessionId = injectAuthSessionId();
  private readonly data = inject(DeploymentsData);
  readonly adminDefaults = injectQuery(() =>
    this.data.adminDefaults(this.sessionId()),
  );
  readonly savingDefaults = signal(false);
  private loadedDefaults: string | null = null;
  readonly defaultsModel = signal<AdminDefaultsModel>({
    uploadLimitMiB: 100,
    proxyCpus: '0.1',
    proxyMemoryMiB: 64,
    logFiles: 3,
    logFileSizeMiB: 10,
  });
  readonly defaultsForm = form(this.defaultsModel, (path) => {
    pattern(
      path.proxyCpus,
      /^(?:0\.0*[1-9]\d{0,2}|[1-9]\d{0,2}(?:\.\d{1,3})?)$/,
      { message: 'Enter a positive CPU amount, such as 1 or 0.5.' },
    );
    validate(path.proxyCpus, ({ value }) =>
      Number(value()) <= 128
        ? null
        : { kind: 'cpuLimit', message: 'CPU allowance cannot exceed 128.' },
    );
    min(path.uploadLimitMiB, 1);
    max(path.uploadLimitMiB, 10240);
    min(path.proxyMemoryMiB, 16);
    max(path.proxyMemoryMiB, 1024);
    min(path.logFiles, 1);
    max(path.logFiles, 20);
    min(path.logFileSizeMiB, 1);
    max(path.logFileSizeMiB, 1024);
  });
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
        const model = this.defaultsModel();
        const defaults: InstanceDeploymentDefaults = {
          uploadLimitBytes: Math.round(model.uploadLimitMiB * 1048576),
          proxyCpus: model.proxyCpus.trim(),
          proxyMemoryBytes: Math.round(model.proxyMemoryMiB * 1048576),
          logFiles: model.logFiles,
          logFileSizeBytes: Math.round(model.logFileSizeMiB * 1048576),
        };
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
