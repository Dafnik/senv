import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBox, lucideGlobe } from '@ng-icons/lucide';
import type {
  PublicDeployment,
  DeploymentAuditEntry,
} from '@senv/api/shared/deployments';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { formatBytes } from '../../ui/format-bytes';
import { injectDeploymentActions } from './deployment-actions';
import { DeploymentConfiguration } from './deployment-configuration';
import { DeploymentHistory } from './deployment-history';
import { DeploymentPin } from './deployment-pin';
import { DeploymentLifecycleActions } from './deployment-lifecycle-actions';
import { DeploymentPreviewActions } from './deployment-preview-actions';
import { DeploymentPreviewStatus } from './deployment-preview-status';
import { DeploymentRetention } from './deployment-retention';
import { DeploymentTags } from './deployment-tags';
import { deploymentSourceLinks } from './deployment-source-links';
import {
  dateLabel,
  statusVariant,
  canMutateDeployment,
} from './deployment-presentation';
@Component({
  selector: 'app-deployment-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    DeploymentConfiguration,
    DeploymentHistory,
    DeploymentPin,
    DeploymentLifecycleActions,
    DeploymentPreviewActions,
    DeploymentPreviewStatus,
    DeploymentRetention,
    DeploymentTags,
  ],
  providers: [provideIcons({ lucideBox, lucideGlobe })],
  template: `
    @let item = deployment();
    <div class="grid gap-6">
      <section
        id="deployment-information"
        aria-label="Deployment information"
        class="bg-card relative rounded-xl border lg:sticky lg:top-2 lg:z-20 lg:shadow-sm"
      >
        <header class="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] md:p-6">
          <div class="grid min-w-0 gap-2 pr-20 sm:pr-0">
            <div
              class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
            >
              <ng-icon
                [name]="item.kind === 'container' ? 'lucideBox' : 'lucideGlobe'"
              />{{ item.kind === 'container' ? 'Container' : 'Static site' }}
              @if (item.removalPending) {
                <span hlmBadge variant="secondary" role="status"
                  >Removal pending</span
                >
              } @else {
                <span hlmBadge [variant]="statusVariant(item.status)">{{
                  item.status
                }}</span>
              }
            </div>
            <h1 class="text-xl font-semibold tracking-tight break-words">
              @if (sourceLinks().branch; as branchUrl) {
                <a
                  [href]="branchUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline-offset-4 hover:underline"
                  >{{ item.source.branch }}</a
                >
              } @else {
                {{ item.source.branch || 'Manual deployment' }}
              }
            </h1>
            <p class="text-muted-foreground text-xs">
              @if (item.source.commit) {
                @if (sourceLinks().commit; as commitUrl) {
                  <a
                    [href]="commitUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="mr-3 font-mono underline-offset-4 hover:underline"
                    [title]="item.source.commit"
                    >{{ item.source.commit.slice(0, 12) }}</a
                  >
                } @else {
                  <span class="mr-3 font-mono" [title]="item.source.commit">{{
                    item.source.commit.slice(0, 12)
                  }}</span>
                }
              }
              Published {{ dateLabel(item.submittedAt) }}
            </p>
          </div>
          <div>
            <div class="inline-flex items-center gap-3">
              @if (canManage() && canMutate(item)) {
                <app-deployment-pin [deployment]="item" [actions]="actions" />
              }
              <app-deployment-preview-actions [deployment]="item" />
            </div>
          </div>
        </header>
        <div
          class="bg-muted/30 flex flex-wrap items-center gap-1 rounded-b-xl border-t px-5 py-2 md:px-6"
        >
          <a hlmBtn size="sm" variant="ghost" [routerLink]="logsLink()"
            >View logs</a
          ><app-deployment-lifecycle-actions
            [deployment]="item"
            [actions]="actions"
            [canManage]="canManage()"
            [isAdmin]="isAdmin()"
          />
        </div>
      </section>
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div class="grid items-start gap-6">
          <app-deployment-configuration
            [deployment]="item"
            [projectSlug]="projectSlug()"
          />
          <app-deployment-history
            title="Audit log"
            [showDeploymentId]="false"
            [entries]="history()"
            [actions]="actions"
            [isAdmin]="isAdmin()"
          />
        </div>
        <aside class="grid gap-6" aria-label="Deployment context">
          <app-deployment-preview-status [deployment]="item" />
          @if (
            item.failureReason ||
            item.status === 'failed' ||
            item.status === 'unhealthy'
          ) {
            <p
              role="alert"
              class="text-destructive border-destructive/20 bg-destructive/5 rounded-md border p-4 text-sm"
            >
              {{
                item.failureReason ||
                  'The deployment did not pass its health check.'
              }}
            </p>
          }
          <section hlmCard>
            <div hlmCardHeader><h2 hlmCardTitle>Source</h2></div>
            <dl hlmCardContent class="grid gap-4 text-sm">
              <div>
                <dt class="text-muted-foreground">Repository</dt>
                <dd class="mt-1 break-all">
                  @if (sourceLinks().repository; as repositoryUrl) {
                    <a
                      [href]="repositoryUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="underline underline-offset-4"
                      >{{ item.source.repository }}</a
                    >
                  } @else {
                    {{ item.source.repository || 'Not configured' }}
                  }
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Branch</dt>
                <dd class="mt-1 break-words">
                  @if (sourceLinks().branch; as branchUrl) {
                    <a
                      [href]="branchUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="underline underline-offset-4"
                      >{{ item.source.branch }}</a
                    >
                  } @else {
                    {{ item.source.branch || 'Not provided' }}
                  }
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Commit</dt>
                <dd class="mt-1 font-mono text-xs break-all">
                  @if (sourceLinks().commit; as commitUrl) {
                    <a
                      [href]="commitUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="underline underline-offset-4"
                      >{{ item.source.commit }}</a
                    >
                  } @else {
                    {{ item.source.commit || 'Not provided' }}
                  }
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">Ready</dt>
                <dd class="mt-1">{{ dateLabel(item.readyAt) }}</dd>
              </div>
            </dl>
          </section>
          <section hlmCard>
            <div hlmCardHeader><h2 hlmCardTitle>Retention & expiry</h2></div>
            <div hlmCardContent class="grid gap-5">
              <app-deployment-retention
                [deployment]="item"
                [explain]="true"
                [context]="true"
              />
              <dl class="grid gap-4 border-t pt-4 text-sm">
                @if (item.retentionStartedAt) {
                  <div>
                    <dt class="text-muted-foreground">Retention started</dt>
                    <dd class="mt-1">
                      {{ dateLabel(item.retentionStartedAt) }}
                    </dd>
                  </div>
                }
                <div>
                  <dt class="text-muted-foreground">
                    Captured retention policy
                  </dt>
                  <dd class="mt-1">
                    {{ item.config.retentionDays }} days when unprotected
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground">Log storage</dt>
                  <dd class="mt-1">
                    {{ item.config.logs.files }} ×
                    {{ formatBytes(item.config.logs.fileSizeBytes) }}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
          <section hlmCard>
            <div hlmCardHeader>
              <h2 hlmCardTitle>Aliases & tags</h2>
              <p hlmCardDescription>Stable addresses for this deployment.</p>
            </div>
            <div hlmCardContent>
              @if (!item.tags.length && !item.branchAlias) {
                <p class="text-muted-foreground mb-4 text-sm">
                  No aliases or tags assigned.
                </p>
              }
              <app-deployment-tags
                [deployment]="item"
                [actions]="actions"
                [canManage]="canManage()"
                [showForm]="true"
              />
            </div>
          </section>
        </aside>
      </div>
    </div>
  `,
})
export class DeploymentOverview {
  readonly deployment = input.required<PublicDeployment>();
  readonly sourceLinks = computed(() =>
    deploymentSourceLinks(this.deployment().source),
  );
  readonly projectSlug = input.required<string>();
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly history = input<DeploymentAuditEntry[]>([]);
  readonly projectId = computed(() => this.deployment().projectId);
  readonly actions = injectDeploymentActions(this.projectId);
  readonly logsLink = computed(() => [
    '/projects',
    this.projectSlug(),
    'deployments',
    this.deployment().id,
    'logs',
  ]);
  readonly dateLabel = dateLabel;
  readonly statusVariant = statusVariant;
  readonly canMutate = canMutateDeployment;
  readonly formatBytes = formatBytes;
}
