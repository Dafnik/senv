import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePackage, lucideArrowUpRight } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { ArtifactsData } from '../../../queries/artifacts';
import { ArtifactDownloadMenu } from '../artifact-download-menu';
import { formatBytes } from '../../../ui/format-bytes';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    NgIcon,
    ArtifactDownloadMenu,
    HlmButtonImports,
    HlmEmptyImports,
    HlmSpinnerImports,
    HlmTableImports,
  ],
  providers: [provideIcons({ lucidePackage, lucideArrowUpRight })],
  selector: 'app-project-artifacts',
  templateUrl: './project-artifacts.html',
})
export class ProjectArtifacts {
  readonly projectId = input.required<string>();
  readonly projectSlug = input.required<string>();
  private readonly data = inject(ArtifactsData);
  private readonly sessionId = injectAuthSessionId();
  readonly offset = linkedSignal({
    source: this.projectId,
    computation: () => 0,
  });
  readonly artifacts = injectQuery(() =>
    this.data.list(this.sessionId(), this.projectId(), this.offset()),
  );
  readonly formatBytes = formatBytes;
}
