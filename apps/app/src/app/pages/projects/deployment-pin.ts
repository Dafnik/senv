import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePin, lucidePinOff } from '@ng-icons/lucide';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import type { DeploymentActions } from './deployment-actions';
@Component({
  selector: 'app-deployment-pin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, HlmButtonImports],
  providers: [provideIcons({ lucidePin, lucidePinOff })],
  template: `<button
    hlmBtn
    variant="ghost"
    size="sm"
    type="button"
    [attr.aria-pressed]="deployment().pinned"
    [attr.aria-label]="
      (deployment().pinned ? 'Unpin deployment ' : 'Pin deployment ') +
      deployment().id
    "
    [disabled]="actions().busy() || !!actions().busyId()"
    (click)="actions().setPinned(deployment())"
  >
    <ng-icon [name]="deployment().pinned ? 'lucidePinOff' : 'lucidePin'" />{{
      deployment().pinned ? 'Unpin' : 'Pin'
    }}
  </button>`,
})
export class DeploymentPin {
  readonly deployment = input.required<PublicDeployment>();
  readonly actions = input.required<DeploymentActions>();
}
