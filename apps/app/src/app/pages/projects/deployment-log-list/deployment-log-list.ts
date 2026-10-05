import {
  CdkVirtualScrollViewport,
  ScrollingModule,
} from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterRenderEffect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import type { DeploymentLogLine } from '../deployment-log-lines';

@Component({
  selector: 'app-deployment-log-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrollingModule, HlmButtonImports, HlmSpinnerImports],
  host: { class: 'block min-w-0' },
  template: `
    <div
      class="flex min-h-10 items-center gap-2 px-5 py-2 text-xs"
      aria-live="polite"
    >
      @if (loadingOlder()) {
        <hlm-spinner aria-label="Loading older logs" />
        <span>Loading older logs…</span>
      } @else if (loadError(); as message) {
        <p role="alert">{{ message }}</p>
        <button hlmBtn variant="outline" size="sm" (click)="requestOlder(true)">
          Try again
        </button>
      } @else {
        <span>{{
          hasOlder() ? 'Scroll up for older logs' : 'Beginning of retained logs'
        }}</span>
      }
    </div>
    <cdk-virtual-scroll-viewport
      [itemSize]="lineHeight"
      [minBufferPx]="240"
      [maxBufferPx]="480"
      class="h-[65vh] min-h-96 pb-5 font-mono text-xs leading-6"
      tabindex="0"
      role="list"
      [attr.aria-label]="label()"
      [attr.aria-busy]="loadingOlder()"
      (scrolledIndexChange)="onScrolledIndex($event)"
    >
      <div
        *cdkVirtualFor="
          let line of lines();
          trackBy: trackLine;
          let index = index
        "
        class="h-6 min-w-max px-5 whitespace-pre"
        role="listitem"
        [attr.aria-posinset]="index + 1"
        [attr.aria-setsize]="hasOlder() ? -1 : lines().length"
        [attr.data-log-line]="line.id"
        [textContent]="line.text"
      ></div>
    </cdk-virtual-scroll-viewport>
  `,
})
export class DeploymentLogList {
  readonly lines = input.required<DeploymentLogLine[]>();
  readonly scope = input.required<string>();
  readonly label = input.required<string>();
  readonly hasOlder = input(false);
  readonly loadingOlder = input(false);
  readonly loadError = input<string | null>(null);
  readonly olderNeeded = output<void>();
  readonly viewport = viewChild(CdkVirtualScrollViewport);
  readonly lineHeight = 24;
  readonly trackLine = (_: number, line: DeploymentLogLine) => line.id;
  private previousScope?: string;
  private firstLine?: string;
  private positioned = false;
  private requestedFirstLine?: string;
  private positionFrame?: number;

  constructor() {
    afterRenderEffect({
      mixedReadWrite: () => {
        const viewport = this.viewport();
        const lines = this.lines();
        const scope = this.scope();
        if (!viewport || !lines.length) return;
        const first = lines[0].id;
        if (scope !== this.previousScope || first !== this.firstLine) {
          const sameScope = scope === this.previousScope;
          const anchor = sameScope
            ? lines.findIndex((line) => line.id === this.firstLine)
            : -1;
          const offset = viewport.measureScrollOffset('top');
          this.positioned = false;
          this.previousScope = scope;
          this.firstLine = first;
          if (!sameScope) this.requestedFirstLine = undefined;
          if (this.positionFrame !== undefined)
            cancelAnimationFrame(this.positionFrame);
          // CDK updates its spacer after rendering. Wait for that update before scrolling.
          this.positionFrame = requestAnimationFrame(() => {
            this.positionFrame = undefined;
            viewport.checkViewportSize();
            viewport.scrollToOffset(
              anchor >= 0
                ? offset + anchor * this.lineHeight
                : Math.max(
                    0,
                    lines.length * this.lineHeight - viewport.getViewportSize(),
                  ),
            );
            this.positioned = true;
            if (viewport.measureScrollOffset('top') <= 10 * this.lineHeight)
              this.requestOlder();
          });
        } else if (
          this.positioned &&
          viewport.measureScrollOffset('top') <= 10 * this.lineHeight
        ) {
          this.requestOlder();
        }
      },
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.positionFrame !== undefined)
        cancelAnimationFrame(this.positionFrame);
    });
  }

  onScrolledIndex(index: number) {
    if (this.positioned && index <= 10) this.requestOlder();
  }

  requestOlder(retry = false) {
    const first = this.lines()[0]?.id;
    if (
      !this.hasOlder() ||
      this.loadingOlder() ||
      (!retry && (this.loadError() || first === this.requestedFirstLine))
    )
      return;
    this.requestedFirstLine = first;
    this.olderNeeded.emit();
  }
}
