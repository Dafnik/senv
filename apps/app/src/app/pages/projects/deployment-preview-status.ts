import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideRefreshCw } from '@ng-icons/lucide';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../auth/auth-client';
import { DeploymentsData } from '../../queries/deployments';
import { isTerminal } from './deployment-presentation';

@Component({
  selector: 'app-deployment-preview-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
  ],
  providers: [provideIcons({ lucideRefreshCw })],
  template: `
    <section hlmCard aria-label="Public preview status">
      <div hlmCardHeader class="flex flex-wrap items-center gap-3">
        <h2 hlmCardTitle>Browser Health check</h2>
        @if (!enabled()) {
          <span hlmBadge variant="secondary">Unavailable</span>
        } @else if (status.data(); as result) {
          <span
            hlmBadge
            [variant]="
              result.statusCode !== null && result.statusCode < 400
                ? 'outline'
                : 'destructive'
            "
            role="status"
          >
            {{
              result.statusCode === null
                ? 'Unreachable'
                : 'HTTP ' + result.statusCode
            }}
          </span>
          <span class="text-muted-foreground text-xs">
            Checked {{ result.checkedAt | date: 'mediumTime' }} ·
            {{ result.responseTimeMs }} ms
          </span>
        } @else if (status.isError()) {
          <span hlmBadge variant="destructive" role="status">Check failed</span>
        } @else {
          <span class="text-muted-foreground text-xs" role="status"
            >Checking preview…</span
          >
        }
      </div>
      @if (
        !enabled() ||
        status.data()?.error ||
        status.isError() ||
        (status.data()?.statusCode ?? 0) >= 400
      ) {
        <div hlmCardContent>
          <p class="text-muted-foreground text-sm break-words">
            @if (!enabled()) {
              The preview is unavailable while this deployment is stopped or
              removed.
            } @else if (status.data()?.error; as error) {
              {{ error }} Container health does not confirm public access.
            } @else if (status.isError()) {
              {{ status.error().message }}
            } @else if ((status.data()?.statusCode ?? 0) >= 400) {
              The public root URL returned an error. Container health does not
              confirm public access.
            }
          </p>
        </div>
      }
      @if (enabled()) {
        <hlm-card-footer>
          <button
            hlmBtn
            size="sm"
            variant="ghost"
            [disabled]="status.isFetching()"
            (click)="status.refetch()"
            aria-label="Check preview again"
          >
            <ng-icon
              name="lucideRefreshCw"
              [class.animate-spin]="status.isFetching()"
            />
            Check again
          </button>
        </hlm-card-footer>
      }
    </section>
  `,
})
export class DeploymentPreviewStatus {
  readonly deployment = input.required<PublicDeployment>();
  private readonly data = inject(DeploymentsData);
  private readonly sessionId = injectAuthSessionId();
  readonly enabled = computed(
    () =>
      !isTerminal(this.deployment()) &&
      this.deployment().desiredState === 'running' &&
      !this.deployment().removalPending,
  );
  readonly status = injectQuery(() =>
    this.data.previewStatus(
      this.sessionId(),
      this.deployment().projectId,
      this.deployment().id,
      this.enabled(),
    ),
  );
}
