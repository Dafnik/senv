import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { DeploymentAuditEntry } from '@senv/api/shared/deployments';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import type { DeploymentActions } from './deployment-actions';
import { dateLabel } from './deployment-presentation';
@Component({
  selector: 'app-deployment-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButtonImports, HlmCardImports, HlmSpinnerImports],
  template: `
    <section hlmCard id="deployment-audit" class="scroll-mt-6">
      <div hlmCardHeader>
        <h2 hlmCardTitle>
          {{ title() }}
        </h2>
        <p hlmCardDescription>
          Deleted and expired deployments keep a non-secret record for review.
        </p>
      </div>
      <div hlmCardContent class="grid gap-2">
        @if (loading()) {
          <hlm-spinner aria-label="Loading deployment history" />
        } @else if (error()) {
          <p role="alert">{{ error() }}</p>
        } @else if (entries().length) {
          @for (entry of entries(); track entry.id) {
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t py-3 text-sm"
            >
              <div>
                <span class="font-medium capitalize">{{
                  entry.event.split('_').join(' ')
                }}</span>
                @if (showDeploymentId()) {
                  <span class="text-muted-foreground ml-2 font-mono text-xs">{{
                    entry.deploymentId
                  }}</span>
                }
                <span class="text-muted-foreground ml-3 text-xs">{{
                  dateLabel(entry.createdAt)
                }}</span>
                <p class="text-muted-foreground mt-1 text-xs">
                  @if (entry.actorType === 'user' && entry.actor) {
                    {{ entry.actor.name }}
                  } @else {
                    System
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
                  (click)="actions().forgetHistory(entry.deploymentId)"
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
  `,
})
export class DeploymentHistory {
  readonly entries = input<DeploymentAuditEntry[]>([]);
  readonly title = input('Deployment history');
  readonly showDeploymentId = input(true);
  readonly isAdmin = input(false);
  readonly loading = input(false);
  readonly error = input('');
  readonly actions = input.required<DeploymentActions>();
  readonly dateLabel = dateLabel;
}
