import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePlay, lucideSquare, lucideTrash2 } from '@ng-icons/lucide';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import type { DeploymentActions } from './deployment-actions';
import { canMutateDeployment, isTerminal } from './deployment-presentation';
@Component({
  selector: 'app-deployment-lifecycle-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex flex-wrap items-center gap-1' },
  imports: [NgIcon, HlmButtonImports],
  providers: [provideIcons({ lucidePlay, lucideSquare, lucideTrash2 })],
  template: `
    @let item = deployment();
    @if (canManage() && canMutate(item)) {
      @if (item.desiredState === 'running') {
        <button
          hlmBtn
          variant="ghost"
          size="sm"
          [disabled]="actions().busy() || !!actions().busyId()"
          (click)="actions().act(item, 'stop')"
        >
          <ng-icon name="lucideSquare" />Stop
        </button>
      } @else if (item.artifactId || item.imageDigest) {
        <button
          hlmBtn
          variant="ghost"
          size="sm"
          [disabled]="actions().busy() || !!actions().busyId()"
          (click)="actions().act(item, 'restart')"
        >
          <ng-icon name="lucidePlay" />Restart
        </button>
      }
      <button
        hlmBtn
        variant="ghost"
        size="sm"
        class="text-destructive hover:text-destructive"
        [disabled]="actions().busy() || !!actions().busyId()"
        (click)="actions().act(item, 'delete')"
      >
        <ng-icon name="lucideTrash2" />Delete
      </button>
    }
    @if (isAdmin() && isTerminal(item)) {
      <button
        hlmBtn
        size="sm"
        variant="ghost"
        [disabled]="actions().busy() || !!actions().busyId()"
        (click)="actions().forgetHistory(item.id)"
      >
        Forget history
      </button>
    }
  `,
})
export class DeploymentLifecycleActions {
  readonly deployment = input.required<PublicDeployment>();
  readonly actions = input.required<DeploymentActions>();
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly canMutate = canMutateDeployment;
  readonly isTerminal = isTerminal;
}
