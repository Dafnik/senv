import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmBreadcrumbImports } from '@spartan-ng/helm/breadcrumb';

export type BreadcrumbItem = { label: string; link?: string[] };

@Component({
  selector: 'app-breadcrumbs',
  imports: [HlmBreadcrumbImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav hlmBreadcrumb aria-label="Breadcrumb">
      <ol hlmBreadcrumbList>
        @for (item of items(); track $index) {
          @if ($index) {
            <li hlmBreadcrumbSeparator></li>
          }
          <li hlmBreadcrumbItem>
            @if (item.link) {
              <a hlmBreadcrumbLink [link]="item.link">{{ item.label }}</a>
            } @else {
              <span hlmBreadcrumbPage>{{ item.label }}</span>
            }
          </li>
        }
      </ol>
    </nav>
  `,
})
export class Breadcrumbs {
  readonly items = input.required<BreadcrumbItem[]>();
}
