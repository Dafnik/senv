import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { formatBytes } from '../../ui/format-bytes';
import type { DeploymentActions } from './deployment-actions';
import { DeploymentPreviewStatus } from './deployment-preview-status';
import { DeploymentRetention } from './deployment-retention';
import { DeploymentTags } from './deployment-tags';
import { deploymentSourceLinks } from './deployment-source-links';
import { dateLabel } from './deployment-presentation';

@Component({
  selector: 'app-deployment-context',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmCardImports,
    DeploymentPreviewStatus,
    DeploymentRetention,
    DeploymentTags,
  ],
  host: { class: 'grid gap-6' },
  templateUrl: './deployment-context.html',
})
export class DeploymentContext {
  readonly deployment = input.required<PublicDeployment>();
  readonly actions = input.required<DeploymentActions>();
  readonly canManage = input(false);
  readonly sourceLinks = computed(() =>
    deploymentSourceLinks(this.deployment().source),
  );
  readonly dateLabel = dateLabel;
  readonly formatBytes = formatBytes;
}
