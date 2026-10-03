import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBox,
  lucideGlobe,
  lucideArrowUpRight,
  lucideChevronDown,
} from '@ng-icons/lucide';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import type { DeploymentActions } from './deployment-actions';
import { DeploymentPin } from './deployment-pin';
import { DeploymentLifecycleActions } from './deployment-lifecycle-actions';
import { DeploymentPreviewActions } from './deployment-preview-actions';
import { DeploymentRetention } from './deployment-retention';
import { DeploymentTags } from './deployment-tags';
import {
  dateLabel,
  statusVariant,
  canMutateDeployment,
} from './deployment-presentation';
@Component({
  selector: 'app-deployment-list-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    DeploymentPin,
    DeploymentLifecycleActions,
    DeploymentPreviewActions,
    DeploymentRetention,
    DeploymentTags,
  ],
  providers: [
    provideIcons({
      lucideBox,
      lucideGlobe,
      lucideArrowUpRight,
      lucideChevronDown,
    }),
  ],
  template: `
    @let item = deployment();
    <article class="bg-card overflow-hidden rounded-xl border">
      <header
        class="relative grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] md:p-6"
      >
        <div class="grid min-w-0 gap-3 pr-20 sm:pr-0">
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
            <app-deployment-tags [deployment]="item" [actions]="actions()" />
          </div>
          <h3 class="text-lg font-semibold tracking-tight">
            <a
              class="break-words hover:underline"
              [routerLink]="detailLink()"
              >{{ item.source.branch || 'Manual deployment' }}</a
            >
          </h3>
          <div
            class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 text-xs"
          >
            <span class="font-mono">{{ item.id }}</span>
            @if (item.source.commit) {
              <span class="font-mono" [title]="item.source.commit">{{
                item.source.commit.slice(0, 12)
              }}</span>
            }
            <span>{{ dateLabel(item.submittedAt) }}</span>
          </div>
        </div>
        <div>
          <div class="inline-flex items-center gap-3">
            @if (canManage() && canMutate(item)) {
              <app-deployment-pin
                class="absolute top-3 right-3 sm:static"
                [deployment]="item"
                [actions]="actions()"
              />
            }
            <app-deployment-preview-actions [deployment]="item" />
          </div>
        </div>
      </header>
      @if (
        item.failureReason ||
        item.status === 'failed' ||
        item.status === 'unhealthy'
      ) {
        <p
          role="alert"
          class="text-destructive border-destructive/20 bg-destructive/5 mx-5 mb-5 rounded-md border p-3 text-sm md:mx-6"
        >
          {{
            item.failureReason ||
              'The deployment did not pass its health check.'
          }}
        </p>
      }
      <div
        class="grid items-start gap-4 px-5 pb-5 sm:grid-cols-[minmax(0,1fr)_auto] md:px-6"
      >
        <div class="grid min-w-0 gap-2">
          @if (item.configurationOutdated) {
            <span class="text-muted-foreground text-xs"
              >Configuration out of date</span
            >
          }
        </div>
      </div>
      <footer class="bg-muted/30 border-t">
        <div
          class="flex flex-wrap items-center justify-between gap-3 px-5 py-3 md:px-6"
        >
          <div class="flex flex-wrap items-center gap-1">
            <a hlmBtn size="sm" variant="ghost" [routerLink]="detailLink()"
              >View details <ng-icon name="lucideArrowUpRight"
            /></a>
            <a hlmBtn size="sm" variant="ghost" [routerLink]="logsLink()"
              >View logs</a
            >
            <app-deployment-lifecycle-actions
              [deployment]="item"
              [actions]="actions()"
              [canManage]="canManage()"
              [isAdmin]="isAdmin()"
            />
          </div>
          <div class="flex items-center gap-1">
            <app-deployment-retention
              class="border-r-2 pr-3"
              [deployment]="item"
              [context]="false"
            />
            @if (canManage() && canMutate(item)) {
              <button
                hlmBtn
                size="sm"
                variant="ghost"
                type="button"
                class="ml-auto shrink-0"
                [attr.aria-expanded]="tagsOpen()"
                [attr.aria-controls]="'deployment-tags-' + item.id"
                (click)="tagsOpen.set(!tagsOpen())"
              >
                Manage tags
                <ng-icon
                  name="lucideChevronDown"
                  [class.rotate-180]="tagsOpen()"
                />
              </button>
            }
          </div>
        </div>
        @if (tagsOpen() && canManage() && canMutate(item)) {
          <div
            [id]="'deployment-tags-' + item.id"
            class="border-t px-5 py-4 md:px-6"
          >
            <app-deployment-tags
              class="max-w-sm"
              [deployment]="item"
              [actions]="actions()"
              [canManage]="canManage()"
              [showForm]="true"
            />
          </div>
        }
      </footer>
    </article>
  `,
})
export class DeploymentListItem {
  readonly deployment = input.required<PublicDeployment>();
  readonly projectSlug = input.required<string>();
  readonly actions = input.required<DeploymentActions>();
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly tagsOpen = signal(false);
  readonly detailLink = computed(() => [
    '/projects',
    this.projectSlug(),
    'deployments',
    this.deployment().id,
  ]);
  readonly logsLink = computed(() => [...this.detailLink(), 'logs']);
  readonly dateLabel = dateLabel;
  readonly statusVariant = statusVariant;
  readonly canMutate = canMutateDeployment;
}
