import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClock } from '@ng-icons/lucide';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { retentionInfo } from './deployment-presentation';
@Component({
  selector: 'app-deployment-retention',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, NgIcon],
  providers: [provideIcons({ lucideClock })],
  template: `
    @let retention = info();
    <div
      class="grid gap-1 text-sm"
      [class.text-destructive]="retention.overdue"
    >
      <p class="flex items-center gap-1.5 font-medium">
        <ng-icon name="lucideClock" /> {{ retention.label }}
        @if (retention.deadline) {
          <time [attr.datetime]="retention.deadline.toISOString()">{{
            retention.deadline | date: 'MMM d, y'
          }}</time>
        }
      </p>
      @if (context()) {
        <p class="text-muted-foreground text-xs first-letter:uppercase">
          {{ retention.context }}
          @if (retention.deadline) {
            · {{ retention.deadline | date: 'shortTime' }}
          }
        </p>
      }
      @if (explain()) {
        <p class="text-muted-foreground mt-2 text-sm leading-6">
          {{ retention.description }}
        </p>
      }
    </div>
  `,
})
export class DeploymentRetention {
  readonly deployment = input.required<PublicDeployment>();
  readonly context = input(false);
  readonly explain = input(false);
  readonly info = computed(() => retentionInfo(this.deployment()));
}
