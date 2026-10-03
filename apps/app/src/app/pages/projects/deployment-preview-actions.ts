import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy, lucideExternalLink } from '@ng-icons/lucide';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmButtonGroupImports } from '@spartan-ng/helm/button-group';

@Component({
  selector: 'app-deployment-preview-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, HlmButtonImports, HlmButtonGroupImports],
  providers: [provideIcons({ lucideCopy, lucideExternalLink })],
  template: `
    @let item = deployment();
    @if (
      !item.removalPending &&
      item.status !== 'deleted' &&
      item.status !== 'cleaned'
    ) {
      <div hlmButtonGroup aria-label="Preview actions">
        @if (item.status === 'healthy') {
          <a
            hlmBtn
            variant="outline"
            [href]="item.previewUrl"
            target="_blank"
            rel="noreferrer"
          >
            Open preview <ng-icon name="lucideExternalLink" />
          </a>
        } @else {
          <button
            hlmBtn
            variant="outline"
            type="button"
            disabled
            title="Available when healthy"
          >
            Open preview <ng-icon name="lucideExternalLink" />
          </button>
        }
        <button
          hlmBtn
          variant="outline"
          size="icon"
          type="button"
          aria-label="Copy preview link"
          title="Copy preview URL"
          (click)="copyPreviewUrl()"
        >
          <ng-icon name="lucideCopy" />
        </button>
      </div>
    }
  `,
})
export class DeploymentPreviewActions {
  readonly deployment = input.required<PublicDeployment>();
  async copyPreviewUrl() {
    try {
      await navigator.clipboard.writeText(this.deployment().previewUrl);
      toast.success('Preview URL copied.');
    } catch {
      toast.error('Could not copy the preview URL.');
    }
  }
}
