import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideDownload,
  lucideChevronRight,
  lucideArrowUp,
  lucidePackage,
} from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { ProjectsData } from '../../../queries/projects';
import { ArtifactsData } from '../../../queries/artifacts';
import { Breadcrumbs } from '../../../ui/breadcrumbs';
import { formatBytes } from '../../../ui/format-bytes';
import { ArtifactDownloadMenu } from '../artifact-download-menu';
import { ArtifactFileIcon } from '../artifact-file-icon';
import { deploymentSourceLinks } from '../deployment-source-links';

@Component({
  selector: 'app-artifact-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    NgIcon,
    Breadcrumbs,
    ArtifactFileIcon,
    ArtifactDownloadMenu,
    HlmButtonImports,
    HlmCardImports,
    HlmEmptyImports,
    HlmSpinnerImports,
    HlmTableImports,
  ],
  providers: [
    provideIcons({
      lucideDownload,
      lucideChevronRight,
      lucideArrowUp,
      lucidePackage,
    }),
  ],
  templateUrl: './artifact-detail.html',
})
export class ArtifactDetail {
  readonly projectSlug = input.required<string>();
  readonly artifactId = input.required<string>();
  readonly path = input('', {
    transform: (value: string | undefined) => value ?? '',
  });
  private readonly sessionId = injectAuthSessionId();
  private readonly projects = inject(ProjectsData);
  readonly data = inject(ArtifactsData);
  readonly project = injectQuery(() =>
    this.projects.bySlug(this.sessionId(), this.projectSlug()),
  );
  readonly projectId = computed(() => this.project.data()?.id ?? '');
  readonly detail = injectQuery(() =>
    this.data.detail(this.sessionId(), this.projectId(), this.artifactId()),
  );
  readonly directory = injectQuery(() =>
    this.data.directory(
      this.sessionId(),
      this.projectId(),
      this.artifactId(),
      this.path(),
    ),
  );
  readonly sourceLinks = computed(() =>
    deploymentSourceLinks(this.detail.data()?.source ?? {}),
  );
  readonly detailLink = computed(() => [
    '/projects',
    this.projectSlug(),
    'artifacts',
    this.artifactId(),
  ]);
  readonly breadcrumbs = computed(() => [
    { label: 'Projects', link: ['/projects'] },
    {
      label: this.project.data()?.name ?? this.projectSlug(),
      link: ['/projects', this.projectSlug(), 'deployments'],
    },
    {
      label: 'Artifacts',
      link: ['/projects', this.projectSlug(), 'artifacts'],
    },
    { label: this.artifactId() },
  ]);
  readonly folders = computed(() =>
    this.path()
      .split('/')
      .filter(Boolean)
      .map((name, index, parts) => ({
        name,
        path: parts.slice(0, index + 1).join('/'),
      })),
  );
  readonly parentPath = computed(() =>
    this.path().split('/').slice(0, -1).join('/'),
  );
  readonly formatBytes = formatBytes;
}
