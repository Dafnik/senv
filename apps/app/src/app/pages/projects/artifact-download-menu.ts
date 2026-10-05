import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload, lucideChevronDown } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { ArtifactsData } from '../../queries/artifacts';

@Component({
  selector: 'app-artifact-download-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, HlmButtonImports, HlmDropdownMenuImports],
  providers: [provideIcons({ lucideDownload, lucideChevronDown })],
  templateUrl: './artifact-download-menu.html',
})
export class ArtifactDownloadMenu {
  readonly projectId = input.required<string>();
  readonly artifactId = input.required<string>();
  readonly compact = input(false);
  readonly data = inject(ArtifactsData);
}
