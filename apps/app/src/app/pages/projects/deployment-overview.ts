import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { injectDeploymentActions } from './deployment-actions';
import { DeploymentHeader } from './deployment-header/deployment-header';
import { DeploymentContext } from './deployment-context';
import { DeploymentConfiguration } from './deployment-configuration';
import { DeploymentHistory } from './deployment-history';

@Component({
  selector: 'app-deployment-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DeploymentHeader,
    DeploymentContext,
    DeploymentConfiguration,
    DeploymentHistory,
  ],
  templateUrl: './deployment-overview.html',
})
export class DeploymentOverview {
  readonly deployment = input.required<PublicDeployment>();
  readonly projectSlug = input.required<string>();
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly projectId = computed(() => this.deployment().projectId);
  readonly actions = injectDeploymentActions(this.projectId);
}
