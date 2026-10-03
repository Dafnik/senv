import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy, lucideLink } from '@ng-icons/lucide';
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
import {
  staticArchiveExtensions,
  type DeploymentAuditEntry,
  type PublicDeployment,
} from '@senv/api/shared/deployments';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { DeploymentUpload } from '../../../queries/deployment-upload';
import { DeploymentsData } from '../../../queries/deployments';

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
    RouterLink,
    NgIcon,
    FormField,
    FormRoot,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSpinnerImports,
    HlmToggleGroupImports,
  ],
  providers: [provideIcons({ lucideCopy, lucideLink })],
  template: `
    <div class="grid gap-6">
      @if (!canManage()) {
        <span hlmBadge variant="secondary" class="w-fit">Read only</span>
      }
      @if (canManage() && !detailDeployment()) {
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
      @if (publishOpen() && canManage() && !detailDeployment()) {
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
                            @if (detailDeployment()) {
                              {{ deployment.id }}
                            } @else {
                              <a
                                [routerLink]="detailLink(deployment)"
                                class="hover:underline"
                                >{{ deployment.id }}</a
                              >
                            }
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

      <section
        id="deployment-information"
        class="grid gap-4"
        aria-label="Deployment information"
      >
        @if (!detailDeployment()) {
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="deployment-list-title" class="text-xl font-semibold">
                Deployments
              </h2>
              <p class="text-muted-foreground mt-1 text-sm">
                Each publication keeps its own content and configuration
                snapshot.
              </p>
            </div>
            @if (deployments.isFetching()) {
              <hlm-spinner aria-label="Refreshing deployments" />
            }
          </div>
        }
        @if (!detailDeployment() && deployments.isPending()) {
          <hlm-spinner aria-label="Loading deployments" />
        } @else if (!detailDeployment() && deployments.isError()) {
          <div hlmCard class="grid gap-3 p-5">
            <p role="alert">{{ deployments.error().message }}</p>
            <button hlmBtn variant="outline" (click)="deployments.refetch()">
              Try again
            </button>
          </div>
        } @else if (deploymentItems().length) {
          @for (deployment of deploymentItems(); track deployment.id) {
            <article hlmCard class="grid gap-4 p-5">
              <header class="flex flex-wrap items-start justify-between gap-3">
                <div class="grid gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-mono text-sm font-semibold">
                      {{ deployment.id }}
                    </h3>
                    @if (deployment.removalPending) {
                      <span hlmBadge variant="secondary" role="status"
                        >Removal pending</span
                      >
                    } @else {
                      <span
                        hlmBadge
                        [variant]="statusVariant(deployment.status)"
                        >{{ deployment.status }}</span
                      >
                    }
                    <span hlmBadge variant="outline">{{
                      deployment.kind
                    }}</span>
                    @if (deployment.configurationOutdated) {
                      <span
                        hlmBadge
                        variant="outline"
                        class="text-muted-foreground"
                        >Configuration out of date</span
                      >
                    }
                    @if (
                      !canManage() ||
                      isTerminal(deployment) ||
                      deployment.removalPending
                    ) {
                      <span hlmBadge variant="secondary">{{
                        deployment.pinned ? 'Pinned' : 'Not pinned'
                      }}</span>
                    }
                  </div>
                  <p class="text-muted-foreground text-sm">
                    {{ deployment.source.branch || 'No branch' }}
                    @if (deployment.source.commit) {
                      · {{ deployment.source.commit }}
                    }
                    @if (deployment.failureReason) {
                      ·
                      <span class="text-destructive">{{
                        deployment.failureReason
                      }}</span>
                    }
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    hlmBtn
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Copy deployment details link"
                    title="Copy deployment details link"
                    (click)="copyDetailsLink(deployment)"
                  >
                    <ng-icon name="lucideLink" />
                  </button>
                  @if (!isTerminal(deployment) && !deployment.removalPending) {
                    <button
                      hlmBtn
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Copy preview link"
                      title="Copy preview link"
                      (click)="copyLink(previewUrl(deployment))"
                    >
                      <ng-icon name="lucideCopy" />
                    </button>
                  }
                  @if (
                    canManage() &&
                    !isTerminal(deployment) &&
                    !deployment.removalPending
                  ) {
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      [attr.aria-pressed]="deployment.pinned"
                      [attr.aria-label]="
                        deployment.pinned
                          ? 'Unpin deployment ' + deployment.id
                          : 'Pin deployment ' + deployment.id
                      "
                      [disabled]="!!busyId()"
                      (click)="setPinned(deployment)"
                    >
                      {{ deployment.pinned ? 'Pinned' : 'Pin deployment' }}
                    </button>
                  }
                  @if (
                    deployment.status === 'healthy' &&
                    !deployment.removalPending
                  ) {
                    <a
                      hlmBtn
                      [href]="previewUrl(deployment)"
                      target="_blank"
                      rel="noreferrer"
                      >Open preview ↗</a
                    >
                  }
                </div>
              </header>
              @if (deployment.tags.length || deployment.branchAlias) {
                <div class="flex flex-wrap items-center gap-2">
                  @if (deployment.branchAlias) {
                    @if (deployment.removalPending) {
                      <span hlmBadge variant="outline"
                        >branch: {{ deployment.branchAlias }}</span
                      >
                    } @else {
                      <a
                        hlmBadge
                        variant="outline"
                        [href]="branchUrl(deployment)"
                        target="_blank"
                        rel="noreferrer"
                        >branch: {{ deployment.branchAlias }}</a
                      >
                    }
                  }
                  @for (tag of deployment.tags; track tag) {
                    <span class="inline-flex items-center gap-1">
                      @if (deployment.removalPending) {
                        <span hlmBadge variant="secondary">{{ tag }}</span>
                      } @else {
                        <a
                          hlmBadge
                          variant="secondary"
                          [href]="tagUrl(deployment, tag)"
                          target="_blank"
                          rel="noreferrer"
                          >{{ tag }} preview</a
                        >
                      }
                      @if (
                        canManage() &&
                        !isTerminal(deployment) &&
                        !deployment.removalPending
                      ) {
                        <button
                          type="button"
                          class="text-muted-foreground rounded-sm px-1 focus-visible:ring-2"
                          [attr.aria-label]="'Remove tag ' + tag"
                          (click)="removeTag(tag)"
                        >
                          ×
                        </button>
                      }
                    </span>
                  }
                </div>
              }
              <dl class="grid gap-3 border-t pt-3 text-sm sm:grid-cols-4">
                <div>
                  <dt class="text-muted-foreground">Submitted</dt>
                  <dd>{{ dateLabel(deployment.submittedAt) }}</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">Artifact</dt>
                  <dd class="font-mono break-all">
                    {{
                      deployment.artifactId ||
                        deployment.imageDigest ||
                        'Unavailable'
                    }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">Configuration</dt>
                  <dd>
                    {{ deployment.config.port }} ·
                    {{ envCount(deployment) }} variables ·
                    {{ deployment.config.secretNames.length }} secrets
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">Expiry</dt>
                  <dd>{{ expiryLabel(deployment) }}</dd>
                </div>
              </dl>
              @if (detailDeployment()) {
                <dl class="grid gap-3 border-t pt-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt class="text-muted-foreground">Ready</dt>
                    <dd>{{ dateLabel(deployment.readyAt) }}</dd>
                  </div>
                  <div>
                    <dt class="text-muted-foreground">Repository</dt>
                    <dd class="break-all">
                      {{ deployment.source.repository || 'Not configured' }}
                    </dd>
                  </div>
                </dl>
              }
              @if (
                deployment.status === 'failed' ||
                deployment.status === 'unhealthy'
              ) {
                <p role="alert" class="text-destructive text-sm">
                  {{
                    deployment.failureReason ||
                      'The deployment did not pass its health check.'
                  }}
                </p>
              }
              <footer class="flex flex-wrap items-center gap-2 border-t pt-3">
                @if (!detailDeployment()) {
                  <a
                    hlmBtn
                    size="sm"
                    variant="outline"
                    [routerLink]="detailLink(deployment)"
                    >View details</a
                  >
                }
                <a
                  hlmBtn
                  size="sm"
                  variant="ghost"
                  [routerLink]="logsLink(deployment)"
                  >View logs</a
                >
                @if (
                  canManage() &&
                  !isTerminal(deployment) &&
                  !deployment.removalPending
                ) {
                  @if (deployment.desiredState === 'running') {
                    <button
                      hlmBtn
                      size="sm"
                      variant="outline"
                      [disabled]="busyId() === deployment.id"
                      (click)="act(deployment, 'stop')"
                    >
                      Stop
                    </button>
                  } @else if (deployment.artifactId || deployment.imageDigest) {
                    <button
                      hlmBtn
                      size="sm"
                      variant="outline"
                      [disabled]="busyId() === deployment.id"
                      (click)="act(deployment, 'restart')"
                    >
                      Restart
                    </button>
                  }
                  <button
                    hlmBtn
                    size="sm"
                    variant="destructive"
                    [disabled]="busyId() === deployment.id"
                    (click)="act(deployment, 'delete')"
                  >
                    Delete
                  </button>
                  <form
                    class="flex flex-wrap items-center gap-2"
                    (submit)="assignTag($event, deployment)"
                  >
                    <label class="sr-only" [attr.for]="'tag-' + deployment.id"
                      >Tag name</label
                    >
                    <input
                      hlmInput
                      class="w-32"
                      [id]="'tag-' + deployment.id"
                      placeholder="Tag name"
                      [value]="tagDrafts()[deployment.id] || ''"
                      (input)="setTagDraft(deployment.id, $event)"
                    />
                    <button
                      hlmBtn
                      size="sm"
                      variant="outline"
                      type="submit"
                      [disabled]="
                        deployment.status !== 'healthy' ||
                        busyId() === deployment.id
                      "
                    >
                      Assign tag
                    </button>
                  </form>
                }
                @if (isAdmin() && isTerminal(deployment)) {
                  <button
                    hlmBtn
                    size="sm"
                    variant="destructive"
                    (click)="forgetHistory(deployment.id)"
                  >
                    Forget history
                  </button>
                }
              </footer>
            </article>
          }
        } @else {
          <div hlmEmpty class="border">
            <div hlmEmptyHeader>
              <h3 hlmEmptyTitle>No deployments yet</h3>
              <p hlmEmptyDescription>
                Publish a static site or container image to create the first
                preview.
              </p>
            </div>
          </div>
        }
      </section>

      @if (detailDeployment(); as deployment) {
        <section hlmCard id="deployment-configuration" class="scroll-mt-6">
          <div hlmCardHeader>
            <h2 hlmCardTitle>Captured configuration</h2>
            <p hlmCardDescription>
              Project settings changes only affect new deployments. This
              deployment continues to use the configuration captured when it was
              published.
            </p>
          </div>
          <div hlmCardContent class="grid gap-4">
            @if (deployment.configurationOutdated) {
              <div role="status" class="bg-muted rounded-lg border p-4">
                <p class="font-medium">Configuration out of date</p>
                <p class="text-muted-foreground mt-1 text-sm">
                  Current settings differ for
                  {{ deployment.configurationChanges.join(', ') }}. Publish a
                  new deployment to apply them.
                </p>
                <a
                  class="mt-2 inline-block text-sm underline"
                  [routerLink]="['/projects', previewSlug(), 'settings']"
                  >Review project settings</a
                >
              </div>
            } @else {
              <p class="text-muted-foreground text-sm">
                Configuration matches current settings.
              </p>
            }
            <dl
              class="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3"
            >
              <div>
                <dt class="text-muted-foreground">HTTP port</dt>
                <dd class="mt-1 font-mono">{{ deployment.config.port }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Origin resources</dt>
                <dd class="mt-1">
                  {{ deployment.config.limits.origin.cpus }} CPUs ·
                  {{ formatBytes(deployment.config.limits.origin.memoryBytes) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Proxy resources</dt>
                <dd class="mt-1">
                  {{ deployment.config.limits.proxy.cpus }} CPUs ·
                  {{ formatBytes(deployment.config.limits.proxy.memoryBytes) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Health check</dt>
                <dd class="mt-1 font-mono">
                  {{ deployment.config.health.path }}
                </dd>
                <dd class="text-muted-foreground mt-1">
                  Every {{ deployment.config.health.intervalSeconds }}s ·
                  {{ deployment.config.health.timeoutSeconds }}s timeout
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Proxy configuration</dt>
                <dd class="mt-1">
                  {{ deployment.config.proxy.routes.length }} routes ·
                  {{ deployment.config.proxy.cacheRules.length }} cache rules
                </dd>
                <dd class="text-muted-foreground mt-1">
                  Compression
                  {{
                    deployment.config.proxy.compression.enabled
                      ? 'enabled'
                      : 'disabled'
                  }}
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Retention policy</dt>
                <dd class="mt-1">
                  {{
                    deployment.config.retentionDays === undefined
                      ? 'Legacy policy'
                      : deployment.config.retentionDays +
                        ' days when unprotected'
                  }}
                </dd>
                <dd class="text-muted-foreground mt-1">
                  Logs: {{ deployment.config.logs.files }} ×
                  {{ formatBytes(deployment.config.logs.fileSizeBytes) }}
                </dd>
              </div>
            </dl>
            <details class="border-t pt-4">
              <summary class="cursor-pointer text-sm font-medium">
                Full configuration snapshot
              </summary>
              <pre
                class="bg-muted mt-3 max-h-[40rem] overflow-auto rounded-lg p-5 font-mono text-xs leading-6"
                tabindex="0"
                aria-label="Captured deployment configuration"
                >{{ safeConfig(deployment) }}</pre>
            </details>
          </div>
        </section>
      }
      <section hlmCard id="deployment-audit" class="scroll-mt-6">
        <div hlmCardHeader>
          <h2 hlmCardTitle>
            {{ detailDeployment() ? 'Audit log' : 'Deployment history' }}
          </h2>
          <p hlmCardDescription>
            Deleted and expired deployments keep a non-secret record for review.
          </p>
        </div>
        <div hlmCardContent class="grid gap-2">
          @if (!detailDeployment() && history.isPending()) {
            <hlm-spinner aria-label="Loading deployment history" />
          } @else if (!detailDeployment() && history.isError()) {
            <p role="alert">{{ history.error().message }}</p>
          } @else if (auditEntries().length) {
            @for (entry of auditEntries(); track entry.id) {
              <div
                class="flex flex-wrap items-center justify-between gap-3 border-t py-3 text-sm"
              >
                <div>
                  <span class="font-mono">{{ entry.deploymentId }}</span
                  ><span class="text-muted-foreground">
                    · {{ entry.event }} · {{ dateLabel(entry.createdAt) }}</span
                  >
                  <p class="text-muted-foreground mt-1 text-xs">
                    @if (entry.actorType === 'user' && entry.actor) {
                      {{ entry.actor.name }}
                      <span class="font-mono">({{ entry.actor.id }})</span>
                    } @else {
                      {{
                        entry.actorType === 'system'
                          ? 'System'
                          : 'Actor unavailable (older entry)'
                      }}
                    }
                  </p>
                </div>
                @if (
                  isAdmin() &&
                  (entry.event === 'deleted' || entry.event === 'cleaned')
                ) {
                  <button
                    hlmBtn
                    size="sm"
                    variant="destructive"
                    (click)="forgetHistory(entry.deploymentId)"
                  >
                    Forget history
                  </button>
                }
              </div>
            }
          } @else {
            <p class="text-muted-foreground text-sm">No retained history.</p>
          }
        </div>
      </section>
    </div>
  `,
})
export class ProjectDeployments {
  readonly projectId = input.required<string>();
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly previewSlug = input('');
  readonly detailDeployment = input<PublicDeployment | null>(null);
  readonly detailHistory = input<DeploymentAuditEntry[]>([]);
  readonly archiveAccept = staticArchiveExtensions.join(',');
  private readonly sessionId = injectAuthSessionId();
  private readonly router = inject(Router);
  private readonly data = inject(DeploymentsData);
  private readonly upload = inject(DeploymentUpload);

  readonly deployments = injectQuery(() =>
    this.data.list(
      this.sessionId(),
      this.projectId(),
      !this.detailDeployment(),
    ),
  );
  readonly history = injectQuery(() =>
    this.data.history(
      this.sessionId(),
      this.projectId(),
      !this.detailDeployment(),
    ),
  );
  readonly projectSettings = injectQuery(() =>
    this.data.settings(this.sessionId(), this.projectId()),
  );
  readonly credentials = injectQuery(() =>
    this.data.credentials(this.sessionId(), this.projectId(), this.canManage()),
  );
  readonly deploymentItems = computed(() =>
    this.detailDeployment()
      ? [this.detailDeployment()!]
      : (this.deployments.data() ?? []),
  );
  readonly auditEntries = computed(() =>
    this.detailDeployment()
      ? this.detailHistory()
      : (this.history.data() ?? []),
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
  readonly busyId = signal('');
  readonly tagDrafts = signal<Record<string, string>>({});
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
        this.busyId.set('');
        this.tagDrafts.set({});
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
  private async withBusy(
    action: () => Promise<unknown>,
    successMessage: string,
    id = '',
  ) {
    if (this.busy() || this.busyId()) return;
    const projectId = this.projectId();
    const sessionId = this.sessionId();
    if (id) {
      this.busyId.set(id);
    } else {
      this.busy.set(true);
    }
    try {
      await action();
      if (projectId !== this.projectId() || sessionId !== this.sessionId())
        return;
      await this.data.invalidate(sessionId, projectId);
      toast.success(successMessage);
    } catch (error) {
      if (projectId === this.projectId() && sessionId === this.sessionId()) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'The request failed. Please try again.',
        );
      }
    } finally {
      if (id) this.busyId.set('');
      else this.busy.set(false);
    }
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

  async setPinned(deployment: PublicDeployment) {
    await this.withBusy(
      () =>
        this.data.setPinned(
          this.projectId(),
          deployment.id,
          !deployment.pinned,
        ),
      deployment.pinned ? 'Deployment unpinned.' : 'Deployment pinned.',
      deployment.id,
    );
  }
  dateLabel(value: Date | string | null) {
    if (!value) return 'Not available';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Not available'
      : date.toLocaleString();
  }
  formatBytes(bytes: number) {
    return bytes >= 1048576
      ? `${(bytes / 1048576).toFixed(1)} MiB`
      : `${(bytes / 1024).toFixed(1)} KiB`;
  }
  envCount(deployment: PublicDeployment) {
    return Object.keys(deployment.config.env).length;
  }
  statusVariant(
    status: PublicDeployment['status'],
  ): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (status === 'healthy') return 'default';
    if (status === 'failed' || status === 'unhealthy') return 'destructive';
    if (status === 'stopped' || status === 'cleaned' || status === 'deleted')
      return 'secondary';
    return 'outline';
  }
  isTerminal(deployment: PublicDeployment) {
    return deployment.status === 'deleted' || deployment.status === 'cleaned';
  }
  previewUrl(deployment: PublicDeployment) {
    return (
      (deployment as PublicDeployment & { previewUrl?: string }).previewUrl ??
      `https://${encodeURIComponent(deployment.id)}.${encodeURIComponent(this.previewSlug())}.preview.localhost`
    );
  }
  branchUrl(deployment: PublicDeployment) {
    const alias = deployment.branchAlias;
    return alias ? this.aliasUrl(deployment, alias) : '';
  }
  tagUrl(deployment: PublicDeployment, tag: string) {
    return this.aliasUrl(deployment, tag);
  }
  private aliasUrl(deployment: PublicDeployment, label: string) {
    try {
      const url = new URL(this.previewUrl(deployment));
      const suffix = url.hostname.slice(url.hostname.indexOf('.') + 1);
      return `${url.protocol}//${label}.${suffix}`;
    } catch {
      return '#';
    }
  }
  safeConfig(deployment: PublicDeployment) {
    const { secretNames, hasSecrets, ...config } = deployment.config;
    return JSON.stringify({ ...config, secretNames, hasSecrets }, null, 2);
  }
  detailLink(deployment: PublicDeployment) {
    return ['/projects', this.previewSlug(), 'deployments', deployment.id];
  }
  logsLink(deployment: PublicDeployment) {
    return [...this.detailLink(deployment), 'logs'];
  }
  copyDetailsLink(deployment: PublicDeployment) {
    const path = this.router.serializeUrl(
      this.router.createUrlTree(this.detailLink(deployment)),
    );
    return this.copyLink(new URL(path, window.location.origin).href);
  }
  async copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied.');
    } catch {
      toast.error(
        'Could not copy the link. Please copy it from the address bar.',
      );
    }
  }
  expiryLabel(deployment: PublicDeployment) {
    if (this.isTerminal(deployment)) return 'Removed';
    if (deployment.pinned) return 'No expiry · pinned';
    if (deployment.tags.length) return 'No expiry · tagged';
    if (deployment.branchAlias) return 'No expiry · current branch';
    return deployment.retentionDeadlineAt
      ? this.dateLabel(deployment.retentionDeadlineAt)
      : 'Starts after startup';
  }
  async act(
    deployment: PublicDeployment,
    action: 'stop' | 'restart' | 'delete',
  ) {
    if (
      action === 'delete' &&
      !window.confirm(
        `Delete deployment ${deployment.id}? Its history will remain.`,
      )
    )
      return;
    await this.withBusy(
      () =>
        action === 'stop'
          ? this.data.stop(this.projectId(), deployment.id)
          : action === 'restart'
            ? this.data.restart(this.projectId(), deployment.id)
            : this.data.remove(this.projectId(), deployment.id),
      action === 'delete'
        ? 'Deployment deleted.'
        : action === 'stop'
          ? 'Deployment stopped.'
          : 'Deployment restarted.',
      deployment.id,
    );
  }
  setTagDraft(id: string, event: Event) {
    this.tagDrafts.update((drafts) => ({
      ...drafts,
      [id]: (event.target as HTMLInputElement).value,
    }));
  }
  async assignTag(event: Event, deployment: PublicDeployment) {
    event.preventDefault();
    const tag = this.tagDrafts()[deployment.id]?.trim().toLowerCase() ?? '';
    if (!/^(?!br-)(?!dpl-)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tag)) {
      toast.error(
        'Enter a lowercase DNS-safe tag. The br- and dpl- prefixes are reserved.',
      );
      return;
    }
    await this.withBusy(
      () => this.data.assignTag(this.projectId(), tag, deployment.id),
      `Tag ${tag} assigned.`,
      deployment.id,
    );
    this.tagDrafts.update((drafts) => ({ ...drafts, [deployment.id]: '' }));
  }
  async removeTag(tag: string) {
    if (!window.confirm(`Remove the ${tag} preview tag?`)) return;
    await this.withBusy(
      () => this.data.removeTag(this.projectId(), tag),
      `Tag ${tag} removed.`,
    );
  }
  async forgetHistory(deploymentId: string) {
    if (!window.confirm(`Permanently remove history for ${deploymentId}?`))
      return;
    await this.withBusy(
      () => this.data.removeHistory(this.projectId(), deploymentId),
      'Deployment history removed.',
    );
  }
}
