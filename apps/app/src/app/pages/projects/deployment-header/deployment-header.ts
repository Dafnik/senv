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
import type { DeploymentActions } from '../deployment-actions';
import { DeploymentLifecycleActions } from '../deployment-lifecycle-actions';
import { DeploymentPin } from '../deployment-pin';
import { DeploymentPreviewActions } from '../deployment-preview-actions';
import { deploymentSourceLinks } from '../deployment-source-links';
import {
  dateLabel,
  statusVariant,
  canMutateDeployment,
} from '../deployment-presentation';

@Component({
  selector: 'app-deployment-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    DeploymentLifecycleActions,
    DeploymentPin,
    DeploymentPreviewActions,
  ],
  providers: [provideIcons({ lucideBox, lucideGlobe })],
  host: { class: 'block min-w-0' },
  templateUrl: './deployment-header.html',
})
export class DeploymentHeader {
  readonly deployment = input.required<PublicDeployment>();
  readonly projectSlug = input.required<string>();
  readonly actions = input.required<DeploymentActions>();
  readonly canManage = input(false);
  readonly isAdmin = input(false);
  readonly sourceLinks = computed(() =>
    deploymentSourceLinks(this.deployment().source),
  );
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
