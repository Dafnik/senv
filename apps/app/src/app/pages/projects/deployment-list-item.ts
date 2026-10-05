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
  templateUrl: './deployment-list-item.html',
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
  readonly dateLabel = dateLabel;
  readonly statusVariant = statusVariant;
  readonly canMutate = canMutateDeployment;
}
