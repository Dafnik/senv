import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  PLATFORM_ID,
} from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../auth/auth-client';
import { DeploymentsData } from '../../queries/deployments';
import { formatBytes } from '../../ui/format-bytes';

@Component({
  selector: 'app-deployment-resources',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, HlmButtonImports, HlmCardImports, HlmSpinnerImports],
  host: { class: 'grid min-w-0 gap-6' },
  templateUrl: './deployment-resources.html',
})
export class DeploymentResources {
  readonly projectId = input.required<string>();
  readonly deploymentId = input.required<string>();
  private readonly data = inject(DeploymentsData);
  private readonly sessionId = injectAuthSessionId();
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly resources = injectQuery(() =>
    this.data.resources(
      this.sessionId(),
      this.projectId(),
      this.deploymentId(),
      this.browser,
    ),
  );

  formatBytes = formatBytes;

  sampledAt(value: Date) {
    return new Date(value).toLocaleTimeString();
  }

  unavailableReason(reason: string) {
    switch (reason) {
      case 'container-missing':
        return 'The origin container is not available.';
      case 'container-stopped':
        return 'The origin container is stopped.';
      default:
        return 'Resource statistics are temporarily unavailable.';
    }
  }
}
