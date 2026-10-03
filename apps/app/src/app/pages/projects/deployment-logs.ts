import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { injectInfiniteQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../auth/auth-client';
import { DeploymentsData } from '../../queries/deployments';

@Component({
  selector: 'app-deployment-logs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    HlmTabsImports,
    HlmButtonImports,
    HlmSpinnerImports,
  ],
  template: `
    <hlm-tabs [tab]="logSource()" (tabActivated)="setLogSource($event)">
      <hlm-tabs-list aria-label="Log source">
        <button hlmTabsTrigger="origin">Origin</button>
        <button hlmTabsTrigger="proxy">Proxy</button>
      </hlm-tabs-list>
      <div hlmTabsContent="origin">
        <ng-container [ngTemplateOutlet]="viewer" />
      </div>
      <div hlmTabsContent="proxy">
        <ng-container [ngTemplateOutlet]="viewer" />
      </div>
    </hlm-tabs>
    <ng-template #viewer>
      <div class="grid gap-3">
        <div
          class="bg-foreground text-background overflow-hidden rounded-lg border"
          [attr.aria-busy]="logs.isPending()"
        >
          @if (logs.isPending()) {
            <div class="flex h-[65vh] min-h-96 items-center justify-center">
              <hlm-spinner aria-label="Loading logs" />
            </div>
          } @else if (logs.isError()) {
            <div
              class="grid h-[75vh] min-h-96 content-center justify-center gap-4 p-6"
            >
              <p role="alert">{{ logs.error().message }}</p>
              <button hlmBtn variant="outline" (click)="logs.refetch()">
                Try again
              </button>
            </div>
          } @else {
            <pre
              class="h-[75vh] min-h-96 overflow-auto p-5 font-mono text-xs leading-6"
              tabindex="0"
              [attr.aria-label]="
                logSource() === 'origin' ? 'Origin logs' : 'Proxy logs'
              "
              >{{ logText() || 'No logs recorded yet.' }}</pre>
          }
        </div>
        @if (logs.hasNextPage()) {
          <button
            hlmBtn
            type="button"
            variant="outline"
            class="w-fit"
            [disabled]="logs.isFetchingNextPage()"
            (click)="loadOlderLogs()"
          >
            @if (logs.isFetchingNextPage()) {
              <hlm-spinner />
            }
            Load older logs
          </button>
        }
        @if (logs.isFetchNextPageError()) {
          <p role="alert">
            {{ logs.error()?.message || 'Could not load older logs.' }}
          </p>
        }
      </div>
    </ng-template>
  `,
})
export class DeploymentLogs {
  readonly projectId = input.required<string>();
  readonly deploymentId = input.required<string>();
  readonly source = input('origin');
  private readonly router = inject(Router);
  private readonly data = inject(DeploymentsData);
  private readonly sessionId = injectAuthSessionId();
  readonly logSource = computed(() =>
    this.source() === 'proxy' ? 'proxy' : 'origin',
  );
  readonly logs = injectInfiniteQuery(() =>
    this.data.logs(
      this.sessionId(),
      this.projectId(),
      this.deploymentId(),
      this.logSource(),
    ),
  );
  readonly logText = computed(() =>
    [...(this.logs.data()?.pages ?? [])]
      .reverse()
      .flatMap((page) => page.logs)
      .map((row) => {
        const date = new Date(row.createdAt);
        return `${Number.isNaN(date.getTime()) ? '' : `[${date.toLocaleString()}] `}${row.content}`;
      })
      .join('\n'),
  );
  setLogSource(source: string) {
    if (source !== 'origin' && source !== 'proxy') return;
    void this.router.navigate([], {
      queryParams: { source },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
  loadOlderLogs() {
    if (this.logs.hasNextPage() && !this.logs.isFetchingNextPage())
      void this.logs.fetchNextPage();
  }
}
