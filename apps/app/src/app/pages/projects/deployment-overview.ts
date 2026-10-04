import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBox, lucideGlobe } from '@ng-icons/lucide';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { injectDeploymentActions } from './deployment-actions';
import { DeploymentContext } from './deployment-context';
import { DeploymentConfiguration } from './deployment-configuration';
import { DeploymentHistory } from './deployment-history';
import { DeploymentPin } from './deployment-pin';
import { DeploymentLifecycleActions } from './deployment-lifecycle-actions';
import { DeploymentPreviewActions } from './deployment-preview-actions';
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
    DeploymentContext,
    DeploymentConfiguration,
    DeploymentHistory,
    DeploymentPin,
    DeploymentLifecycleActions,
    DeploymentPreviewActions,
  ],
  providers: [provideIcons({ lucideBox, lucideGlobe })],
  templateUrl: './deployment-overview.html',
})
export class DeploymentOverview {
  readonly deployment = input.required<PublicDeployment>();
  readonly sourceLinks = computed(() =>
    deploymentSourceLinks(this.deployment().source),
  );
  readonly projectSlug = input.required<string>();
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly projectId = computed(() => this.deployment().projectId);
  readonly actions = injectDeploymentActions(this.projectId);
  readonly logsLink = computed(() => [
    '/projects',
    this.projectSlug(),
    'deployments',
    this.deployment().id,
    'logs',
  ]);
  readonly resourcesLink = computed(() => [
    '/projects',
    this.projectSlug(),
    'deployments',
    this.deployment().id,
    'resources',
  ]);
  readonly dateLabel = dateLabel;
  readonly statusVariant = statusVariant;
  readonly canMutate = canMutateDeployment;
}
