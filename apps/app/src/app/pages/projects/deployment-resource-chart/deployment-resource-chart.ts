import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { DeploymentResourceHistory } from '@senv/api/shared/deployment-resources';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmChartImports } from '@spartan-ng/helm/chart';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import {
  resourceChartOptions,
  type ResourceMetric,
} from './resource-chart-options';

@Component({
  selector: 'app-deployment-resource-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButtonImports,
    HlmCardImports,
    HlmChartImports,
    HlmSpinnerImports,
  ],
  host: { class: 'block min-w-0' },
  template: `
    <section hlmCard [attr.aria-labelledby]="metric() + '-history-title'">
      <header hlmCardHeader>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 hlmCardTitle [id]="metric() + '-history-title'">
            {{ title() }} history
          </h2>
          <span class="text-muted-foreground text-xs"
            >Last 20 minutes · Every 30 seconds</span
          >
        </div>
      </header>
      <div hlmCardContent>
        @if (pending()) {
          <div class="flex h-64 items-center justify-center" aria-busy="true">
            <hlm-spinner
              [attr.aria-label]="'Loading ' + title() + ' history'"
            />
          </div>
        } @else if (error(); as message) {
          <div class="grid h-64 content-center justify-items-start gap-3">
            <p role="alert">{{ message }}</p>
            <button hlmBtn variant="outline" (click)="retry.emit()">
              Try again
            </button>
          </div>
        } @else if (hasSamples()) {
          <tanstack-chart hlmChart [options]="options()!" />
        } @else {
          <div
            class="text-muted-foreground grid h-64 content-center gap-2 text-center"
            role="status"
          >
            <p class="text-foreground font-medium">
              No {{ title() }} samples yet
            </p>
            <p class="text-sm">History appears as the origin container runs.</p>
          </div>
        }
      </div>
    </section>
  `,
})
export class DeploymentResourceChart {
  readonly metric = input.required<ResourceMetric>();
  readonly history = input<DeploymentResourceHistory>();
  readonly pending = input(false);
  readonly error = input<string | null>(null);
  readonly retry = output<void>();
  readonly title = computed(() => (this.metric() === 'cpu' ? 'CPU' : 'Memory'));
  readonly hasSamples = computed(
    () =>
      this.history()?.points.some(
        (point) =>
          (this.metric() === 'cpu'
            ? point.cpuPercent
            : point.memoryUsedBytes) !== null,
      ) ?? false,
  );
  readonly options = computed(() => {
    const history = this.history();
    return history ? resourceChartOptions(history, this.metric()) : undefined;
  });
}
