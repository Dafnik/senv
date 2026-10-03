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
  form,
  FormField,
  FormRoot,
  max,
  min,
  required,
  submit,
} from '@angular/forms/signals';
import { staticArchiveExtensions } from '@senv/api/shared/deployments';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { DeploymentUpload } from '../../../queries/deployment-upload';
import { DeploymentsData } from '../../../queries/deployments';
import { DeploymentView } from '../deployment-view';
import { formatBytes } from '../../../ui/format-bytes';

type PublishModel = {
  kind: 'static' | 'container';
  image: string;
  registryCredentialId: string;
  pinned: boolean;
  commit: string;
  branch: string;
  port: number;
  reuseArtifactId: string;
};

@Component({
  selector: 'app-project-deployments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DeploymentView,
    FormField,
    FormRoot,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
    HlmToggleGroupImports,
  ],
  template: `
    <div class="grid gap-6">
      @if (!canManage()) {
        <span hlmBadge variant="secondary" class="w-fit">Read only</span>
      }
      @if (canManage()) {
        <div class="flex justify-end">
          <button
            hlmBtn
            type="button"
            [disabled]="busy()"
            (click)="publishOpen.set(!publishOpen())"
            [attr.aria-expanded]="publishOpen()"
            aria-controls="publish-deployment-card"
          >
            {{ publishOpen() ? 'Close publish form' : 'Publish' }}
          </button>
        </div>
      }
      @if (publishOpen() && canManage()) {
        <section hlmCard id="publish-deployment-card">
          <div hlmCardHeader>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="grid gap-1">
                <h2 hlmCardTitle>Publish a deployment</h2>
                <p hlmCardDescription>
                  Upload a built site or point to an existing container image.
                </p>
              </div>
              @if (!canManage()) {
                <span hlmBadge variant="secondary">Read only</span>
              }
            </div>
          </div>
          @if (canManage()) {
            <form
              hlmCardContent
              class="grid gap-5"
              [formRoot]="publishForm"
              (submit)="publish($event)"
            >
              <fieldset class="grid gap-3" [disabled]="busy()">
                <legend class="text-sm font-medium">Deployment source</legend>
                <hlm-toggle-group
                  type="single"
                  variant="outline"
                  [nullable]="false"
                  [disabled]="busy()"
                  [value]="model().kind"
                  (valueChange)="setKind($event)"
                  aria-label="Deployment source"
                >
                  <button hlmToggleGroupItem type="button" value="static">
                    Static site
                  </button>
                  <button hlmToggleGroupItem type="button" value="container">
                    Container image
                  </button>
                </hlm-toggle-group>
              </fieldset>

              @if (model().kind === 'static') {
                <div class="grid gap-4">
                  <fieldset class="grid gap-3">
                    <legend class="text-sm font-medium">Website files</legend>
                    <p class="text-muted-foreground text-sm">
                      The Archive root or selected directory must contain
                      index.html.
                    </p>
                    <div class="grid gap-2 sm:grid-cols-2">
                      <label class="grid gap-2 rounded-md border p-3 text-sm">
                        <span>Archive</span>
                        <input
                          type="file"
                          [accept]="archiveAccept"
                          [disabled]="busy()"
                          aria-label="Choose a ZIP or TAR archive"
                          (change)="selectArchive($event)"
                        />
                      </label>
                      <label class="grid gap-2 rounded-md border p-3 text-sm">
                        <span>Built site directory</span>
                        <input
                          type="file"
                          webkitdirectory
                          directory
                          multiple
                          [disabled]="busy()"
                          aria-label="Choose a built site directory"
                          (change)="selectDirectory($event)"
                        />
                      </label>
                    </div>
                    @if (selectedFileLabel()) {
                      <p class="text-muted-foreground text-sm" role="status">
                        Selected {{ selectedFileLabel() }}
                      </p>
                    }
                  </fieldset>
                  @if (availableArtifacts().length) {
                    <div hlmField>
                      <label hlmFieldLabel for="reuse-artifact"
                        >Reuse retained artifact</label
                      >
                      <hlm-native-select
                        id="reuse-artifact"
                        [formField]="publishForm.reuseArtifactId"
                      >
                        <option value="">Upload new files</option>
                        @for (
                          deployment of availableArtifacts();
                          track deployment.artifactId
                        ) {
                          <option [value]="deployment.id">
                            {{ deployment.id }}
                            ·
                            {{ deployment.source.branch || 'no branch' }}
                          </option>
                        }
                      </hlm-native-select>
                      <p hlmFieldDescription>
                        Reuse creates a new deployment with an independent
                        retention clock.
                      </p>
                    </div>
                  }
                </div>
              } @else {
                <div class="grid gap-4 sm:grid-cols-2">
                  <div hlmField class="sm:col-span-2">
                    <label hlmFieldLabel for="deployment-image"
                      >Registry image</label
                    >
                    <input
                      hlmInput
                      id="deployment-image"
                      placeholder="ghcr.io/acme/web:latest"
                      autocomplete="off"
                      [formField]="publishForm.image"
                    />
                    <p hlmFieldDescription>
                      We resolve this reference to a fixed digest when it is
                      published.
                    </p>
                    @if (publishForm.image().touched()) {
                      @for (
                        error of publishForm.image().errors();
                        track error
                      ) {
                        <hlm-field-error>{{ error.message }}</hlm-field-error>
                      }
                    }
                  </div>
                  @if (credentials.data()?.length) {
                    <div hlmField>
                      <label hlmFieldLabel for="registry-credential"
                        >Private registry credential</label
                      >
                      <hlm-native-select
                        id="registry-credential"
                        [formField]="publishForm.registryCredentialId"
                      >
                        <option value="">Public image</option>
                        @for (
                          credential of credentials.data();
                          track credential.id
                        ) {
                          <option [value]="credential.id">
                            {{ credential.name }} · {{ credential.registry }}
                          </option>
                        }
                      </hlm-native-select>
                      <p hlmFieldDescription>
                        Saved credentials are never shown here.
                      </p>
                    </div>
                  }
                  <div hlmField>
                    <label hlmFieldLabel for="http-port">HTTP port</label>
                    <input
                      hlmInput
                      id="http-port"
                      type="number"
                      [formField]="publishForm.port"
                    />
                    @if (publishForm.port().touched()) {
                      @for (error of publishForm.port().errors(); track error) {
                        <hlm-field-error>{{ error.message }}</hlm-field-error>
                      }
                    }
                  </div>
                </div>
              }

              <fieldset class="grid gap-4 border-t pt-4">
                <legend class="text-sm font-medium">
                  Source and retention
                </legend>
                <div class="grid gap-4 sm:grid-cols-2">
                  <p class="text-muted-foreground text-sm sm:col-span-2">
                    Repository:
                    {{
                      projectSettings.data()?.repository ||
                        'No project repository configured'
                    }}
                  </p>
                  <div hlmField>
                    <label hlmFieldLabel for="source-commit">Commit</label>
                    <input
                      hlmInput
                      id="source-commit"
                      autocomplete="off"
                      [formField]="publishForm.commit"
                    />
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel for="source-branch">Branch</label>
                    <input
                      hlmInput
                      id="source-branch"
                      autocomplete="off"
                      [formField]="publishForm.branch"
                    />
                    <p hlmFieldDescription>
                      A healthy publication becomes the selected deployment for
                      this branch.
                    </p>
                  </div>
                  <div
                    hlmField
                    orientation="horizontal"
                    class="rounded-md border p-4 sm:col-span-2"
                  >
                    <hlm-checkbox
                      inputId="deployment-pinned"
                      aria-labelledby="publish-pinned-label"
                      [formField]="publishForm.pinned"
                    />
                    <div hlmFieldContent>
                      <label
                        hlmFieldLabel
                        id="publish-pinned-label"
                        for="deployment-pinned"
                        >Pin deployment</label
                      >
                      <p hlmFieldDescription>
                        Keep this preview until you unpin or delete it.
                      </p>
                    </div>
                  </div>
                </div>
              </fieldset>

              <p class="text-muted-foreground text-sm">
                Environment variables and secrets are captured from project
                settings when you publish.
              </p>
              @if (formError()) {
                <p role="alert" class="text-destructive text-sm">
                  {{ formError() }}
                </p>
              }
              @if (uploading()) {
                <p
                  role="status"
                  class="text-muted-foreground flex items-center gap-2 text-sm"
                >
                  <hlm-spinner /> Uploading and validating website files…
                </p>
              }
              <div class="flex flex-wrap items-center gap-3">
                <button
                  hlmBtn
                  type="submit"
                  [disabled]="busy() || publishForm().invalid()"
                >
                  @if (busy()) {
                    <hlm-spinner />
                  }
                  Publish deployment
                </button>
                <button
                  hlmBtn
                  type="button"
                  variant="ghost"
                  [disabled]="busy()"
                  (click)="resetDraft()"
                >
                  Clear draft
                </button>
                <span class="text-muted-foreground text-xs"
                  >Draft settings are saved in this browser.</span
                >
              </div>
            </form>
          } @else {
            <div hlmCardContent class="text-muted-foreground text-sm">
              You can view deployments and their non-secret configuration. Ask a
              project developer or admin to publish.
            </div>
          }
        </section>
      }

      <app-deployment-view
        [projectId]="projectId()"
        [previewSlug]="previewSlug()"
        [canManage]="canManage()"
        [isAdmin]="isAdmin()"
        [items]="deployments.data() ?? []"
        [history]="history.data() ?? []"
        [loading]="deployments.isPending()"
        [refreshing]="deployments.isFetching()"
        [error]="deployments.error()?.message ?? ''"
        [historyLoading]="history.isPending()"
        [historyError]="history.error()?.message ?? ''"
        (reload)="deployments.refetch()"
      />
    </div>
  `,
})
export class ProjectDeployments {
  readonly projectId = input.required<string>();
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly previewSlug = input('');
  readonly archiveAccept = staticArchiveExtensions.join(',');
  private readonly sessionId = injectAuthSessionId();
  private readonly data = inject(DeploymentsData);
  private readonly upload = inject(DeploymentUpload);

  readonly deployments = injectQuery(() =>
    this.data.list(this.sessionId(), this.projectId()),
  );
  readonly history = injectQuery(() =>
    this.data.history(this.sessionId(), this.projectId()),
  );
  readonly projectSettings = injectQuery(() =>
    this.data.settings(this.sessionId(), this.projectId()),
  );
  readonly credentials = injectQuery(() =>
    this.data.credentials(this.sessionId(), this.projectId(), this.canManage()),
  );
  readonly publishOpen = signal(false);
  readonly model = signal<PublishModel>(this.emptyModel());
  readonly publishForm = form(this.model, (path) => {
    required(path.image, {
      when: ({ valueOf }) =>
        valueOf(path.kind) === 'container' && !valueOf(path.reuseArtifactId),
      message: 'Enter a container image.',
    });
    min(path.port, 1, { message: 'Use a port from 1 to 65535.' });
    max(path.port, 65535, { message: 'Use a port from 1 to 65535.' });
  });
  readonly busy = signal(false);
  readonly uploading = signal(false);
  readonly formError = signal('');
  private readonly archiveFile = signal<File | null>(null);
  private readonly directoryFiles = signal<FileList | null>(null);
  readonly selectedFileLabel = computed(() => {
    const zip = this.archiveFile();
    const files = this.directoryFiles();
    if (zip) return `${zip.name} (${this.formatBytes(zip.size)})`;
    if (files?.length)
      return `${files.length} files (${this.formatBytes(Array.from(files).reduce((n, file) => n + file.size, 0))})`;
    return '';
  });
  readonly availableArtifacts = computed(() =>
    (this.deployments.data() ?? []).filter(
      (item) =>
        item.kind === this.model().kind &&
        (item.artifactId || item.imageDigest) &&
        ['healthy', 'unhealthy', 'stopped'].includes(item.status),
    ),
  );
  private readonly draftLoadedFor = signal('');

  constructor() {
    effect(() => {
      const key = this.draftKey();
      if (this.draftLoadedFor() !== key) {
        this.publishOpen.set(false);
        this.clearFiles();
        this.formError.set('');
        this.model.set(this.loadDraft(key));
        this.draftLoadedFor.set(key);
        return;
      }
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, JSON.stringify(this.model()));
    });
  }

  setKind(
    value:
      'static' | 'container' | Array<'static' | 'container'> | null | undefined,
  ) {
    const kind = Array.isArray(value) ? value[value.length - 1] : value;
    if (!kind) return;
    this.model.update((draft) => ({ ...draft, kind, reuseArtifactId: '' }));
    this.clearFiles();
  }
  selectArchive(event: Event) {
    const file = (event.target as HTMLInputElement).files?.item(0) ?? null;
    this.archiveFile.set(file);
    this.directoryFiles.set(null);
    this.model.update((draft) => ({ ...draft, reuseArtifactId: '' }));
  }
  selectDirectory(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    this.directoryFiles.set(files?.length ? files : null);
    this.archiveFile.set(null);
    this.model.update((draft) => ({ ...draft, reuseArtifactId: '' }));
  }
  resetDraft() {
    this.model.set(this.emptyModel());
    this.publishForm().reset();
    this.clearFiles();
    this.formError.set('');
  }
  private emptyModel(): PublishModel {
    return {
      kind: 'static',
      image: '',
      registryCredentialId: '',
      pinned: false,
      commit: '',
      branch: '',
      port: 80,
      reuseArtifactId: '',
    };
  }
  private draftKey() {
    return `senv:deployment-draft:${this.sessionId()}:${this.projectId()}`;
  }
  private loadDraft(key: string): PublishModel {
    const empty = this.emptyModel();
    if (typeof localStorage === 'undefined') return empty;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (typeof stored === 'object' && stored !== null) {
        const draft = stored as Partial<PublishModel>;
        return Object.fromEntries(
          Object.entries(empty).map(([key, value]) => [
            key,
            draft[key as keyof PublishModel] ?? value,
          ]),
        ) as PublishModel;
      }
    } catch {
      /* Ignore malformed local drafts. */
    }
    return empty;
  }
  private clearFiles() {
    this.archiveFile.set(null);
    this.directoryFiles.set(null);
  }
  publish(event: Event) {
    event.preventDefault();
    this.formError.set('');
    void submit(this.publishForm, async () => {
      if (this.busy()) return;
      const draft = this.model();
      const projectId = this.projectId();
      const sessionId = this.sessionId();
      this.busy.set(true);
      try {
        const reusable = this.availableArtifacts().find(
          (item) => item.id === draft.reuseArtifactId,
        );
        let artifactId: string | undefined;
        if (draft.kind === 'static' && !reusable) {
          this.uploading.set(true);
          const artifact = this.archiveFile()
            ? await this.upload.archive(projectId, this.archiveFile()!)
            : this.directoryFiles()
              ? await this.upload.directory(projectId, this.directoryFiles()!)
              : null;
          if (!artifact)
            throw new Error(
              'Choose a ZIP or TAR archive or a built site directory.',
            );
          artifactId = artifact.artifactId;
        }
        if (projectId !== this.projectId() || sessionId !== this.sessionId())
          return;
        await this.data.publish({
          projectId,
          kind: draft.kind,
          ...(reusable
            ? { reuseDeploymentId: reusable.id }
            : draft.kind === 'static'
              ? { artifactId }
              : {
                  image: draft.image.trim(),
                  registryCredentialId: draft.registryCredentialId || undefined,
                }),
          pinned: draft.pinned,
          source: {
            commit: draft.commit.trim() || undefined,
            branch: draft.branch.trim() || undefined,
          },
          port: draft.port,
        });
        if (projectId !== this.projectId() || sessionId !== this.sessionId())
          return;
        await this.data.invalidate(sessionId, projectId);
        this.resetDraft();
        this.publishOpen.set(false);
        toast.success(
          'Deployment submitted. Its status will update as it starts.',
        );
      } catch (error) {
        if (projectId === this.projectId() && sessionId === this.sessionId()) {
          this.formError.set(
            error instanceof Error
              ? error.message
              : 'The deployment could not be submitted.',
          );
        }
      } finally {
        this.uploading.set(false);
        this.busy.set(false);
      }
    });
  }

  readonly formatBytes = formatBytes;
}
