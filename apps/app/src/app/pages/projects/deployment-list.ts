import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectDeploymentActions } from './deployment-actions';
import { DeploymentListItem } from './deployment-list-item';
import { DeploymentHistory } from './deployment-history';
@Component({
  selector: 'app-deployment-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonImports,
    HlmEmptyImports,
    HlmSpinnerImports,
    DeploymentListItem,
    DeploymentHistory,
  ],
  template: `
    <div class="grid gap-6">
      <section class="grid gap-4" aria-labelledby="deployment-list-title">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2 id="deployment-list-title" class="text-xl font-semibold">
            Deployments
          </h2>
          <div class="flex items-center gap-3">
            @if (refreshing()) {
              <hlm-spinner aria-label="Refreshing deployments" />
            }
            <ng-content select="[deployment-list-actions]" />
          </div>
        </div>
        @if (loading()) {
          <hlm-spinner aria-label="Loading deployments" />
        } @else if (error()) {
          <div class="grid justify-items-start gap-3 rounded-xl border p-5">
            <p role="alert">{{ error() }}</p>
            <button hlmBtn variant="outline" (click)="reload.emit()">
              Try again
            </button>
          </div>
        } @else if (items().length) {
          @for (deployment of items(); track deployment.id) {
            <app-deployment-list-item
              [deployment]="deployment"
              [projectSlug]="previewSlug()"
              [actions]="actions"
              [canManage]="canManage()"
              [isAdmin]="isAdmin()"
            />
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
      <app-deployment-history [projectId]="projectId()" />
    </div>
  `,
})
export class DeploymentList {
  readonly projectId = input.required<string>();
  readonly previewSlug = input('');
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly items = input<PublicDeployment[]>([]);
  readonly loading = input(false);
  readonly refreshing = input(false);
  readonly error = input('');
  readonly reload = output<void>();
  readonly actions = injectDeploymentActions(this.projectId);
}
