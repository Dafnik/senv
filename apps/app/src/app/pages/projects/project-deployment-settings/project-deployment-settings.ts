import { Router, RouterLink } from '@angular/router';
import {
  ChangeDetectionStrategy,
  Component,
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
  maxLength,
  max,
  min,
  pattern,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import {
  repositoryUrlSchema,
  deploymentHealthSchema,
  proxyRouteSchema,
  cacheRuleSchema,
  type DeploymentSettings,
} from '@senv/api/shared/deployments';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { DeploymentsData } from '../../../queries/deployments';
import { DurationInput } from '../../../ui/duration-input/duration-input';
import { ProjectRuntimeSettings } from '../project-runtime-settings/project-runtime-settings';
import { ProjectRegistryCredentials } from '../project-registry-credentials/project-registry-credentials';
import { ProjectsData } from '../../../queries/projects';

type SettingsModel = Omit<DeploymentSettings, 'originMemoryBytes' | 'proxy'> & {
  originMemoryMiB: number;
  compressionEndings: string;
  proxy: Omit<DeploymentSettings['proxy'], 'routes'> & {
    routes: Array<
      Omit<DeploymentSettings['proxy']['routes'][number], 'rewrite'> & {
        rewrite: string;
      }
    >;
  };
};

@Component({
  selector: 'app-project-deployment-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DurationInput,
    ProjectRuntimeSettings,
    ProjectRegistryCredentials,
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
  ],
  styles: `
    fieldset {
      position: relative;
      min-width: 0;
    }
    legend {
      padding: 0;
      margin-bottom: 0.75rem;
      font-size: 1rem;
      letter-spacing: -0.015em;
    }
    @media (min-width: 1024px) {
      fieldset {
        padding-left: 14rem;
        min-height: 4rem;
      }
      legend {
        position: absolute;
        left: 0;
        top: 1.25rem;
        max-width: 12rem;
      }
      fieldset:first-child legend {
        top: 0;
      }
    }
  `,
  template: `
    <div class="grid gap-6">
      <nav
        aria-label="Settings sections"
        class="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 border-b pb-4 text-sm font-medium"
      >
        <a
          [routerLink]="[]"
          fragment="deployment-settings"
          queryParamsHandling="preserve"
          class="hover:text-foreground"
          >Deployment settings</a
        >
        <a
          [routerLink]="[]"
          fragment="runtime-settings"
          queryParamsHandling="preserve"
          class="hover:text-foreground"
          >Runtime configuration</a
        >
        <a
          [routerLink]="[]"
          fragment="registry-settings"
          queryParamsHandling="preserve"
          class="hover:text-foreground"
          >Registry credentials</a
        >
        <a
          [routerLink]="[]"
          fragment="project-identity"
          queryParamsHandling="preserve"
          class="hover:text-foreground"
          >Project identity</a
        >
      </nav>
      <section hlmCard id="deployment-settings" class="scroll-mt-6">
        <div hlmCardHeader>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="grid gap-1">
              <h2 hlmCardTitle>Deployment settings</h2>
              <p hlmCardDescription>
                Project settings changes only affect new deployments. Existing
                deployments keep their captured configuration.
              </p>
            </div>
            <span hlmBadge variant="outline">{{
              canManage() ? 'Developer access' : 'Read only'
            }}</span>
          </div>
        </div>
        @if (settings.isPending()) {
          <div hlmCardContent>
            <hlm-spinner aria-label="Loading deployment settings" />
          </div>
        } @else if (settings.isError()) {
          <div hlmCardContent class="grid gap-3">
            <p role="alert">{{ settings.error().message }}</p>
            <button hlmBtn variant="outline" (click)="settings.refetch()">
              Try again
            </button>
          </div>
        } @else {
          <form
            hlmCardContent
            class="grid gap-6"
            [formRoot]="settingsForm"
            (submit)="saveSettings($event)"
          >
            <fieldset class="grid gap-4" [disabled]="!canManage() || saving()">
              <legend class="font-medium">Source repository</legend>
              <div class="grid gap-4 sm:grid-cols-2">
                <div hlmField class="sm:col-span-2">
                  <label hlmFieldLabel for="project-repository"
                    >Project repository</label
                  >
                  <input
                    hlmInput
                    id="project-repository"
                    type="url"
                    placeholder="https://github.com/acme/web"
                    [formField]="settingsForm.repository"
                  />
                  <p hlmFieldDescription>
                    One repository for the project. Source commits and branches
                    refer to this repository.
                  </p>
                  @if (settingsForm.repository().touched()) {
                    @for (
                      error of settingsForm.repository().errors();
                      track error
                    ) {
                      <hlm-field-error>{{ error.message }}</hlm-field-error>
                    }
                  }
                </div>
              </div>
            </fieldset>

            <fieldset
              class="grid gap-4 border-t pt-5"
              [disabled]="!canManage() || saving()"
            >
              <legend class="font-medium">Static site routing</legend>
              <div
                hlmField
                orientation="horizontal"
                class="rounded-md border p-4"
              >
                <hlm-checkbox
                  inputId="project-spa-fallback"
                  aria-labelledby="project-spa-label"
                  [formField]="settingsForm.spaFallback"
                />
                <div hlmFieldContent>
                  <label
                    hlmFieldLabel
                    id="project-spa-label"
                    for="project-spa-fallback"
                    >Serve index.html for client-side routes</label
                  >
                  <p hlmFieldDescription>
                    Use the site entry page when a request does not match a
                    file. Applies to new static deployments in this project.
                  </p>
                </div>
              </div>
            </fieldset>

            <fieldset
              class="grid gap-4 border-t pt-5"
              [disabled]="!isAdmin() || saving()"
            >
              <legend class="font-medium">Retention</legend>
              <div class="grid gap-4 sm:grid-cols-2">
                <div hlmField>
                  <label hlmFieldLabel for="retention-days"
                    >Retention period in days</label
                  >
                  <input
                    hlmInput
                    id="retention-days"
                    type="number"
                    [formField]="settingsForm.retentionDays"
                  />
                  @if (settingsForm.retentionDays().touched()) {
                    @for (
                      error of settingsForm.retentionDays().errors();
                      track error
                    ) {
                      <hlm-field-error>{{ error.message }}</hlm-field-error>
                    }
                  }
                </div>
              </div>
              <p class="text-muted-foreground text-sm">
                Unpinned deployments without a tag or current branch expire
                after this period.
              </p>
            </fieldset>
            <fieldset
              class="grid gap-4 border-t pt-5"
              [disabled]="!isAdmin() || saving()"
            >
              <legend class="font-medium">Resources</legend>
              <p class="text-muted-foreground text-sm">
                CPU and memory limits for each new origin container. Managed by
                project admins.
              </p>
              <div class="grid gap-4 sm:grid-cols-2">
                <div hlmField>
                  <label hlmFieldLabel for="origin-cpus"
                    >Origin CPU cores per deployment</label
                  >
                  <input
                    hlmInput
                    id="origin-cpus"
                    inputmode="decimal"
                    [formField]="settingsForm.originCpus"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="origin-memory"
                    >Origin memory in MiB</label
                  >
                  <input
                    hlmInput
                    id="origin-memory"
                    type="number"
                    [formField]="settingsForm.originMemoryMiB"
                  />
                </div>
              </div>
            </fieldset>

            <fieldset
              class="grid gap-4 border-t pt-5"
              [disabled]="!canManage() || saving()"
            >
              <legend class="font-medium">Health checks</legend>
              <div class="grid gap-4 sm:grid-cols-2">
                <div hlmField>
                  <label hlmFieldLabel for="health-path">HTTP path</label
                  ><input
                    hlmInput
                    id="health-path"
                    [formField]="settingsForm.health.path"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="health-startup"
                    >Startup deadline (seconds)</label
                  ><app-duration-input
                    inputId="health-startup"
                    [secondsOnly]="true"
                    label="Startup deadline"
                    [formField]="settingsForm.health.startupDeadlineSeconds"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="health-interval"
                    >Probe interval (seconds)</label
                  ><app-duration-input
                    inputId="health-interval"
                    [secondsOnly]="true"
                    label="Probe interval"
                    [formField]="settingsForm.health.intervalSeconds"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="health-timeout"
                    >Probe timeout (seconds)</label
                  ><app-duration-input
                    inputId="health-timeout"
                    [secondsOnly]="true"
                    label="Probe timeout"
                    [formField]="settingsForm.health.timeoutSeconds"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="health-threshold"
                    >Failed probes before unhealthy</label
                  ><input
                    hlmInput
                    id="health-threshold"
                    type="number"
                    [formField]="settingsForm.health.unhealthyThreshold"
                  />
                </div>
              </div>
            </fieldset>

            <fieldset
              class="grid gap-4 border-t pt-5"
              [disabled]="!canManage() || saving()"
            >
              <legend class="font-medium">Reverse proxy routes</legend>
              <p class="text-muted-foreground text-sm">
                Routes match request paths and forward to reachable HTTP(S)
                services. More specific paths take priority and matching routes
                bypass the cache.
              </p>
              @for (
                route of settingsForm.proxy.routes;
                track $index;
                let routeIndex = $index
              ) {
                <div class="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                  <div hlmField>
                    <label hlmFieldLabel [attr.for]="'route-path-' + routeIndex"
                      >Path</label
                    ><input
                      hlmInput
                      [id]="'route-path-' + routeIndex"
                      placeholder="/api"
                      [formField]="route.path"
                    />
                  </div>
                  <div hlmField>
                    <label
                      hlmFieldLabel
                      [attr.for]="'route-target-' + routeIndex"
                      >HTTP(S) destination</label
                    ><input
                      hlmInput
                      [id]="'route-target-' + routeIndex"
                      placeholder="https://api.internal"
                      [formField]="route.target"
                    />
                  </div>
                  <div hlmField>
                    <label
                      hlmFieldLabel
                      [attr.for]="'route-rewrite-' + routeIndex"
                      >Optional path rewrite</label
                    ><input
                      hlmInput
                      [id]="'route-rewrite-' + routeIndex"
                      placeholder="/v1"
                      [formField]="route.rewrite"
                    />
                  </div>
                  <div class="flex items-end justify-end">
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      (click)="removeRoute(routeIndex)"
                    >
                      Remove route
                    </button>
                  </div>
                  <div
                    class="bg-muted/50 text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs sm:col-span-2"
                    aria-live="polite"
                  >
                    <span class="font-medium">Request preview</span>
                    <code class="mt-1 block break-all">{{
                      routePreview(routeIndex)
                    }}</code>
                  </div>
                  <div hlmField>
                    <label
                      hlmFieldLabel
                      [attr.for]="'route-connect-' + routeIndex"
                      >Connect timeout (seconds)</label
                    ><app-duration-input
                      label="Connect timeout"
                      [inputId]="'route-connect-' + routeIndex"
                      [secondsOnly]="true"
                      [formField]="route.connectTimeoutSeconds"
                    />
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel [attr.for]="'route-read-' + routeIndex"
                      >Response timeout (seconds)</label
                    ><app-duration-input
                      label="Response timeout"
                      [inputId]="'route-read-' + routeIndex"
                      [secondsOnly]="true"
                      [formField]="route.readTimeoutSeconds"
                    />
                  </div>
                </div>
              }
              <button
                hlmBtn
                variant="outline"
                type="button"
                (click)="addRoute()"
              >
                Add proxy route
              </button>
            </fieldset>

            <fieldset
              class="grid gap-4 border-t pt-5"
              [disabled]="!canManage() || saving()"
            >
              <legend class="font-medium">Response cache rules</legend>
              <p class="text-muted-foreground text-sm">
                Caching starts off. Path rules take precedence over extension
                rules. Proxy routes always bypass the cache.
              </p>
              @for (
                rule of settingsForm.proxy.cacheRules;
                track $index;
                let ruleIndex = $index
              ) {
                <div class="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                  <div hlmField>
                    <label
                      hlmFieldLabel
                      [attr.for]="'cache-matcher-' + ruleIndex"
                      >Match by</label
                    >
                    <hlm-native-select
                      [selectId]="'cache-matcher-' + ruleIndex"
                      [formField]="rule.matcher"
                      ><option value="path">Request path</option>
                      <option value="extension">
                        File extension
                      </option></hlm-native-select
                    >
                  </div>
                  <div hlmField>
                    <label
                      hlmFieldLabel
                      [attr.for]="'cache-value-' + ruleIndex"
                      >{{
                        rule.matcher().value() === 'path'
                          ? 'Request path'
                          : 'File extension'
                      }}</label
                    ><input
                      hlmInput
                      [id]="'cache-value-' + ruleIndex"
                      [placeholder]="
                        rule.matcher().value() === 'path' ? '/assets' : '.js'
                      "
                      [formField]="rule.value"
                    />
                  </div>
                  <div class="flex items-end gap-3 sm:col-span-2">
                    <div hlmField class="flex-1">
                      <label
                        hlmFieldLabel
                        [attr.for]="'cache-duration-' + ruleIndex"
                        >Duration</label
                      ><app-duration-input
                        label="Cache duration"
                        [inputId]="'cache-duration-' + ruleIndex"
                        [formField]="rule.durationSeconds"
                      />
                    </div>
                    <button
                      hlmBtn
                      variant="outline"
                      type="button"
                      (click)="removeCacheRule(ruleIndex)"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              }
              <button
                hlmBtn
                variant="outline"
                type="button"
                (click)="addCacheRule()"
              >
                Add cache rule
              </button>
            </fieldset>

            <fieldset
              class="grid gap-4 border-t pt-5"
              [disabled]="!canManage() || saving()"
            >
              <legend class="font-medium">Compression</legend>
              <div class="flex items-center gap-2 text-sm">
                <hlm-checkbox
                  inputId="compression-enabled"
                  [formField]="settingsForm.proxy.compression.enabled"
                /><label for="compression-enabled"
                  >Compress eligible responses</label
                >
              </div>
              <div hlmField>
                <label hlmFieldLabel for="compression-endings"
                  >Allowed file endings</label
                ><input
                  hlmInput
                  id="compression-endings"
                  placeholder=".css, .js, .svg"
                  [value]="model().compressionEndings"
                  (input)="setCompressionEndings($event)"
                />
                <p hlmFieldDescription>
                  Separate extensions with commas. Leave empty to use the server
                  defaults.
                </p>
              </div>
            </fieldset>

            @if (formError()) {
              <p role="alert" class="text-destructive text-sm">
                {{ formError() }}
              </p>
            }
            @if (canManage()) {
              <div class="flex flex-wrap items-center gap-3 border-t pt-4">
                <button
                  hlmBtn
                  type="submit"
                  [disabled]="saving() || settingsForm().invalid()"
                >
                  @if (saving()) {
                    <hlm-spinner />
                  }
                  Save project defaults
                </button>
                <button
                  hlmBtn
                  type="button"
                  variant="ghost"
                  [disabled]="saving()"
                  (click)="discardDraft()"
                >
                  Discard draft
                </button>
                <span class="text-muted-foreground text-xs"
                  >Unsaved settings are saved in this browser.</span
                >
              </div>
            }
          </form>
        }
      </section>

      <app-project-runtime-settings
        [projectId]="projectId()"
        [canManage]="canManage()"
      />
      <app-project-registry-credentials
        [projectId]="projectId()"
        [canManage]="canManage()"
      />
      <section hlmCard id="project-identity" class="scroll-mt-6">
        <div hlmCardHeader>
          <h2 hlmCardTitle>Project identity</h2>
          <p hlmCardDescription>
            Changing this slug immediately stops all old deployment preview
            links and senv project, deployment, and log links from working.
            Shared links must use the new slug.
          </p>
        </div>
        <div hlmCardContent class="grid gap-6">
          <ng-content />
          @if (isAdmin()) {
            <form
              class="grid gap-3 sm:max-w-xl"
              [formRoot]="slugForm"
              (submit)="saveSlug($event)"
            >
              <div hlmField>
                <label hlmFieldLabel for="project-preview-slug-setting"
                  >Project preview slug</label
                >
                <input
                  hlmInput
                  id="project-preview-slug-setting"
                  autocomplete="off"
                  spellcheck="false"
                  [formField]="slugForm.previewSlug"
                />
                <p hlmFieldDescription>
                  Lowercase letters, digits, and internal hyphens. The project
                  keeps its identity when this changes.
                </p>
                @if (slugForm.previewSlug().touched()) {
                  @for (error of slugForm.previewSlug().errors(); track error) {
                    <hlm-field-error>{{ error.message }}</hlm-field-error>
                  }
                }
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  hlmBtn
                  type="submit"
                  [disabled]="
                    savingSlug() ||
                    slugForm().invalid() ||
                    slugModel().previewSlug === previewSlug()
                  "
                >
                  @if (savingSlug()) {
                    <hlm-spinner />
                  }
                  Save preview slug</button
                ><button
                  hlmBtn
                  type="button"
                  variant="outline"
                  [disabled]="
                    savingSlug() || slugModel().previewSlug === previewSlug()
                  "
                  (click)="discardSlugDraft()"
                >
                  Discard slug change</button
                ><span class="text-muted-foreground text-xs"
                  >Slug draft is saved in this browser.</span
                >
              </div>
              @if (slugError()) {
                <p role="alert" class="text-destructive text-sm">
                  {{ slugError() }}
                </p>
              }
            </form>
          } @else {
            <dl>
              <dt class="text-muted-foreground text-sm">
                Project preview slug
              </dt>
              <dd class="font-mono">{{ previewSlug() }}</dd>
            </dl>
          }
        </div>
      </section>
    </div>
  `,
})
export class ProjectDeploymentSettings {
  readonly projectId = input.required<string>();
  readonly previewSlug = input('');
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  private readonly sessionId = injectAuthSessionId();
  private readonly data = inject(DeploymentsData);
  private readonly projects = inject(ProjectsData);
  private readonly router = inject(Router);
  readonly settings = injectQuery(() =>
    this.data.settings(this.sessionId(), this.projectId()),
  );
  readonly model = signal<SettingsModel>(this.emptySettings());
  readonly settingsForm = form(this.model, (path) => {
    disabled(path.spaFallback, () => !this.canManage() || this.saving());
    validate(path.repository, ({ value }) =>
      repositoryUrlSchema.safeParse(value().trim()).success
        ? undefined
        : {
            kind: 'repository',
            message:
              'Use an HTTP(S) repository URL or SSH URL without credentials, queries, or fragments.',
          },
    );
    min(path.retentionDays, 1, {
      message: 'Retention must be at least one day.',
    });
    max(path.retentionDays, 3650, {
      message: 'Retention cannot exceed 3650 days.',
    });
    min(path.originMemoryMiB, 16, { message: 'Use at least 16 MiB.' });
    max(path.originMemoryMiB, 1048576, {
      message: 'Origin memory cannot exceed 1 TiB.',
    });
    required(path.health.path, {
      message: 'Enter an absolute HTTP probe path.',
    });
    pattern(
      path.originCpus,
      /^(?:0\.0*[1-9]\d{0,2}|[1-9]\d{0,2}(?:\.\d{1,3})?)$/,
      { message: 'Enter a positive CPU amount, such as 1 or 0.5.' },
    );
    validate(path.originCpus, ({ value }) =>
      Number(value()) <= 128
        ? null
        : { kind: 'cpuLimit', message: 'CPU allowance cannot exceed 128.' },
    );
    validate(path.health.path, ({ value }) =>
      deploymentHealthSchema.shape.path.safeParse(value()).success
        ? undefined
        : {
            kind: 'healthPath',
            message:
              'Enter an absolute normalized path without a query or fragment.',
          },
    );
    validate(path.health.timeoutSeconds, ({ value, valueOf }) =>
      value() <= valueOf(path.health.intervalSeconds)
        ? null
        : {
            kind: 'healthTimeout',
            message: 'Probe timeout cannot exceed the polling interval.',
          },
    );
    validate(path.compressionEndings, ({ value }) =>
      value()
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .every((entry) => /^\.?[A-Za-z0-9]+$/.test(entry))
        ? null
        : {
            kind: 'compressionEndings',
            message: 'Use comma-separated file extensions such as .css, .js.',
          },
    );
    for (const duration of [
      path.health.startupDeadlineSeconds,
      path.health.intervalSeconds,
      path.health.timeoutSeconds,
    ]) {
      validate(duration, ({ value }) =>
        Number.isInteger(value())
          ? null
          : {
              kind: 'duration',
              message:
                'Enter a duration that equals a whole number of seconds.',
            },
      );
    }
    min(path.health.startupDeadlineSeconds, 5);
    max(path.health.startupDeadlineSeconds, 3600);
    min(path.health.intervalSeconds, 1);
    max(path.health.intervalSeconds, 300);
    min(path.health.timeoutSeconds, 1);
    max(path.health.timeoutSeconds, 60);
    min(path.health.unhealthyThreshold, 1);
    max(path.health.unhealthyThreshold, 20);
    applyEach(path.proxy.routes, (route) => {
      required(route.path, { message: 'Enter a route path.' });
      required(route.target, { message: 'Enter an HTTP(S) destination.' });
      validate(route.path, ({ value, valueOf }) => {
        const routes = valueOf(path.proxy.routes);
        if (!proxyRouteSchema.shape.path.safeParse(value()).success)
          return {
            kind: 'routePath',
            message: 'Use a normalized absolute path.',
          };
        return routes.filter((item) => item.path === value()).length > 1
          ? {
              kind: 'duplicateRoute',
              message: 'This route path is already configured.',
            }
          : null;
      });
      validate(route.target, ({ value }) =>
        proxyRouteSchema.shape.target.safeParse(value()).success
          ? undefined
          : {
              kind: 'routeTarget',
              message:
                'Use an HTTP(S) destination without credentials, query, fragments, or unsafe characters.',
            },
      );
      validate(route.rewrite, ({ value }) =>
        proxyRouteSchema.shape.rewrite.safeParse(value() || undefined).success
          ? undefined
          : {
              kind: 'routeRewrite',
              message: 'Enter an absolute rewrite path or leave it blank.',
            },
      );
      for (const duration of [
        route.connectTimeoutSeconds,
        route.readTimeoutSeconds,
      ]) {
        validate(duration, ({ value }) =>
          Number.isInteger(value())
            ? null
            : {
                kind: 'duration',
                message:
                  'Enter a duration that equals a whole number of seconds.',
              },
        );
      }
      min(route.connectTimeoutSeconds, 1);
      max(route.connectTimeoutSeconds, 300);
      min(route.readTimeoutSeconds, 1);
      max(route.readTimeoutSeconds, 3600);
    });
    applyEach(path.proxy.cacheRules, (rule) => {
      required(rule.value, { message: 'Enter a request path or extension.' });
      validate(rule.durationSeconds, ({ value }) =>
        Number.isInteger(value())
          ? null
          : {
              kind: 'duration',
              message:
                'Enter a duration that equals a whole number of seconds.',
            },
      );
      min(rule.durationSeconds, 1);
      max(rule.durationSeconds, 604800);
      validate(rule.value, ({ value, valueOf }) => {
        const matcher = valueOf(rule.matcher);
        const rules = valueOf(path.proxy.cacheRules);
        const valid = cacheRuleSchema.safeParse({
          matcher,
          value: value(),
          durationSeconds: valueOf(rule.durationSeconds),
        }).success;
        if (!valid)
          return {
            kind: 'cacheMatcher',
            message:
              matcher === 'path'
                ? 'Enter an absolute normalized request path.'
                : 'Enter a file extension such as .js.',
          };
        return rules.filter(
          (item) => item.matcher === matcher && item.value === value(),
        ).length > 1
          ? {
              kind: 'duplicateCacheRule',
              message: 'This cache matcher is already configured.',
            }
          : null;
      });
    });
  });
  readonly slugModel = signal({ previewSlug: '' });
  readonly slugForm = form(this.slugModel, (path) => {
    required(path.previewSlug, { message: 'Enter a preview slug.' });
    maxLength(path.previewSlug, 63, { message: 'Use 63 characters or fewer.' });
    pattern(path.previewSlug, /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
      message: 'Use lowercase letters, digits, and internal hyphens.',
    });
  });
  readonly saving = signal(false);
  readonly savingSlug = signal(false);
  readonly formError = signal('');
  readonly slugError = signal('');
  private loadedProject = '';
  private loadedSlugKey = '';

  constructor() {
    effect(() => {
      const projectId = `${this.sessionId()}:${this.projectId()}`;
      const value = this.settings.data();
      if (!value || this.loadedProject === projectId) return;
      this.loadedProject = projectId;
      this.model.set(
        this.loadDraft(this.projectId()) ?? this.fromSettings(value),
      );
    });
    effect(() => {
      const projectId = this.projectId();
      if (
        this.loadedProject !== `${this.sessionId()}:${projectId}` ||
        typeof localStorage === 'undefined'
      )
        return;
      localStorage.setItem(
        this.draftKey(projectId),
        JSON.stringify(this.model()),
      );
    });
    effect(() => {
      const key = this.slugKey();
      if (this.loadedSlugKey === key) return;
      this.loadedSlugKey = key;
      let slug = this.previewSlug();
      if (typeof localStorage !== 'undefined') {
        try {
          slug = localStorage.getItem(key) || slug;
        } catch {
          /* Use the current slug when storage is unavailable. */
        }
      }
      this.slugModel.set({ previewSlug: slug });
    });
    effect(() => {
      const key = this.slugKey();
      if (this.loadedSlugKey !== key || typeof localStorage === 'undefined')
        return;
      const slug = this.slugModel().previewSlug;
      if (slug === this.previewSlug()) localStorage.removeItem(key);
      else localStorage.setItem(key, slug);
    });
  }

  private emptySettings(): SettingsModel {
    return {
      spaFallback: false,
      repository: '',
      retentionDays: 7,
      originCpus: '1',
      originMemoryMiB: 512,
      health: {
        path: '/',
        startupDeadlineSeconds: 60,
        intervalSeconds: 5,
        timeoutSeconds: 3,
        unhealthyThreshold: 3,
      },
      proxy: {
        routes: [],
        cacheRules: [],
        compression: { enabled: true, endings: [] },
      },
      compressionEndings: '',
    };
  }
  private fromSettings(value: DeploymentSettings): SettingsModel {
    return {
      ...value,
      originMemoryMiB: value.originMemoryBytes / 1048576,
      proxy: {
        ...value.proxy,
        routes: value.proxy.routes.map((route) => ({
          ...route,
          rewrite: route.rewrite ?? '',
        })),
      },
      compressionEndings: value.proxy.compression.endings.join(', '),
    };
  }
  private draftKey(projectId: string) {
    return `senv:deployment-settings:${this.sessionId()}:${projectId}`;
  }
  private slugKey() {
    return `senv:preview-slug:${this.sessionId()}:${this.projectId()}`;
  }
  private loadDraft(projectId: string): SettingsModel | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const value: unknown = JSON.parse(
        localStorage.getItem(this.draftKey(projectId)) ?? 'null',
      );
      return typeof value === 'object' && value !== null
        ? ({ ...this.emptySettings(), ...value } as SettingsModel)
        : null;
    } catch {
      return null;
    }
  }
  private toSettings(model: SettingsModel): DeploymentSettings {
    return {
      spaFallback: model.spaFallback,
      repository: model.repository.trim(),
      retentionDays: model.retentionDays,
      originCpus: model.originCpus.trim(),
      originMemoryBytes: Math.round(model.originMemoryMiB * 1048576),
      health: model.health,
      proxy: {
        ...model.proxy,
        routes: model.proxy.routes.map((route) => ({
          ...route,
          path: route.path.trim(),
          target: route.target.trim(),
          rewrite: route.rewrite.trim() || undefined,
        })),
        cacheRules: model.proxy.cacheRules.map((rule) => ({
          ...rule,
          value: rule.value.trim(),
        })),
        compression: {
          ...model.proxy.compression,
          endings: model.compressionEndings
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`)),
        },
      },
    };
  }
  addRoute() {
    this.model.update((value) => ({
      ...value,
      proxy: {
        ...value.proxy,
        routes: [
          ...value.proxy.routes,
          {
            path: '',
            target: '',
            rewrite: '',
            connectTimeoutSeconds: 10,
            readTimeoutSeconds: 60,
          },
        ],
      },
    }));
  }
  removeRoute(index: number) {
    this.model.update((value) => ({
      ...value,
      proxy: {
        ...value.proxy,
        routes: value.proxy.routes.filter((_, i) => i !== index),
      },
    }));
  }
  addCacheRule() {
    this.model.update((value) => ({
      ...value,
      proxy: {
        ...value.proxy,
        cacheRules: [
          ...value.proxy.cacheRules,
          { matcher: 'path', value: '', durationSeconds: 300 },
        ],
      },
    }));
  }
  removeCacheRule(index: number) {
    this.model.update((value) => ({
      ...value,
      proxy: {
        ...value.proxy,
        cacheRules: value.proxy.cacheRules.filter((_, i) => i !== index),
      },
    }));
  }
  setCompression(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked;
    this.model.update((value) => ({
      ...value,
      proxy: {
        ...value.proxy,
        compression: { ...value.proxy.compression, enabled },
      },
    }));
  }
  setCompressionEndings(event: Event) {
    this.model.update((value) => ({
      ...value,
      compressionEndings: (event.target as HTMLInputElement).value,
    }));
  }
  discardDraft() {
    const settings = this.settings.data();
    if (!settings) return;
    localStorage.removeItem(this.draftKey(this.projectId()));
    this.model.set(this.fromSettings(settings));
    this.settingsForm().reset();
  }
  async saveSettings(event: Event) {
    event.preventDefault();
    if (!this.canManage() || this.saving()) return;
    void submit(this.settingsForm, async () => {
      this.saving.set(true);
      const projectId = this.projectId();
      const sessionId = this.sessionId();
      try {
        const settings = this.toSettings(this.model());
        await this.data.updateSettings(projectId, settings);
        if (projectId !== this.projectId() || sessionId !== this.sessionId())
          return;
        await this.data.invalidate(sessionId, projectId);
        this.model.set(this.fromSettings(settings));
        localStorage.removeItem(this.draftKey(projectId));
        this.formError.set('');
        toast.success('Project deployment defaults saved.');
      } catch (error) {
        this.formError.set(
          error instanceof Error
            ? error.message
            : 'Settings could not be saved.',
        );
      } finally {
        this.saving.set(false);
      }
    });
  }
  discardSlugDraft() {
    if (typeof localStorage !== 'undefined')
      localStorage.removeItem(this.slugKey());
    this.slugModel.set({ previewSlug: this.previewSlug() });
    this.slugForm().reset();
    this.slugError.set('');
  }
  routePreview(index: number) {
    const route = this.model().proxy.routes[index];
    if (!route?.path || !route.target)
      return 'Enter a path and destination to preview forwarding.';
    try {
      const target = new URL(
        route.target.includes('://') ? route.target : `http://${route.target}`,
      );
      const prefix = route.path === '/' ? '' : route.path.replace(/\/+$/, '');
      const rewrite =
        route.rewrite.trim() ||
        (target.pathname === '/' ? '' : target.pathname);
      const destination = rewrite ? rewrite.replace(/\/+$/, '') : prefix;
      return `${prefix}/example → ${target.origin}${destination}/example`;
    } catch {
      return 'Enter a valid HTTP(S) destination.';
    }
  }
  async saveSlug(event: Event) {
    event.preventDefault();
    if (!this.isAdmin() || this.savingSlug()) return;
    void submit(this.slugForm, async () => {
      this.savingSlug.set(true);
      const projectId = this.projectId();
      const sessionId = this.sessionId();
      try {
        const changed = await this.projects.updatePreviewSlug(
          projectId,
          this.slugModel().previewSlug.trim(),
        );
        if (projectId !== this.projectId() || sessionId !== this.sessionId())
          return;
        localStorage.removeItem(this.slugKey());
        await this.router.navigate(
          ['/projects', changed.previewSlug, 'settings'],
          { replaceUrl: true },
        );
        await this.projects.invalidate(sessionId, projectId);
        this.slugError.set('');
        toast.success(
          'Project slug changed. Old preview and senv links stopped working immediately.',
        );
      } catch (error) {
        this.slugError.set(
          error instanceof Error
            ? error.message
            : 'The preview slug could not be saved.',
        );
      } finally {
        this.savingSlug.set(false);
      }
    });
  }
}
