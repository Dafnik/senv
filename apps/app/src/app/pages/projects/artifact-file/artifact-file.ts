import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  PLATFORM_ID,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy, lucideDownload, lucideArrowLeft } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { ArtifactsData } from '../../../queries/artifacts';
import { ProjectsData } from '../../../queries/projects';
import { Breadcrumbs } from '../../../ui/breadcrumbs';
import { formatBytes } from '../../../ui/format-bytes';
import { ArtifactFileIcon } from '../artifact-file-icon';

@Component({
  selector: 'app-artifact-file',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    NgIcon,
    Breadcrumbs,
    ArtifactFileIcon,
    HlmButtonImports,
    HlmCardImports,
    HlmSpinnerImports,
  ],
  providers: [provideIcons({ lucideCopy, lucideDownload, lucideArrowLeft })],
  templateUrl: './artifact-file.html',
  styleUrl: './artifact-file.css',
})
export class ArtifactFile {
  readonly projectSlug = input.required<string>();
  readonly artifactId = input.required<string>();
  readonly path = input('', {
    transform: (value: string | undefined) => value ?? '',
  });
  private readonly sessionId = injectAuthSessionId();
  private readonly projects = inject(ProjectsData);
  private readonly http = inject(HttpClient);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly data = inject(ArtifactsData);
  readonly project = injectQuery(() =>
    this.projects.bySlug(this.sessionId(), this.projectSlug()),
  );
  readonly projectId = computed(() => this.project.data()?.id ?? '');
  readonly file = injectQuery(() =>
    this.data.file(
      this.sessionId(),
      this.projectId(),
      this.artifactId(),
      this.path(),
    ),
  );
  readonly artifactLink = computed(() => [
    '/projects',
    this.projectSlug(),
    'artifacts',
    this.artifactId(),
  ]);
  readonly parentPath = computed(() =>
    this.path().split('/').slice(0, -1).join('/'),
  );
  readonly downloadUrl = computed(() =>
    this.data.downloadUrl(this.projectId(), this.artifactId(), {
      path: this.path(),
    }),
  );
  readonly breadcrumbs = computed(() => [
    { label: 'Projects', link: ['/projects'] },
    {
      label: this.project.data()?.name ?? this.projectSlug(),
      link: ['/projects', this.projectSlug(), 'artifacts'],
    },
    { label: this.artifactId(), link: this.artifactLink() },
    { label: this.path().split('/').at(-1) || 'File' },
  ]);
  readonly code = resource({
    params: () => {
      const file = this.file.data();
      return this.browser && file?.text !== null && file?.text !== undefined
        ? { text: file.text, language: file.language ?? 'text' }
        : undefined;
    },
    loader: async ({ params }) => {
      const { highlightCode } = await import('./highlighted-code');
      return highlightCode(params.text, params.language);
    },
  });
  readonly image = resource({
    params: () => {
      const file = this.file.data();
      return this.browser && file?.kind === 'image' && !file.reason
        ? { url: this.downloadUrl(), mime: file.mime, path: file.path }
        : undefined;
    },
    loader: async ({ params, abortSignal }) => {
      const blob = await firstValueFrom(
        this.http
          .get(params.url, { responseType: 'blob', withCredentials: true })
          .pipe(takeUntil(fromEvent(abortSignal, 'abort'))),
      );
      return {
        blob: new Blob([blob], { type: params.mime }),
        path: params.path,
      };
    },
  });
  readonly imageUrl = signal<string | null>(null);
  readonly copyStatus = linkedSignal({
    source: this.path,
    computation: () => '',
  });
  readonly imageFailed = linkedSignal({
    source: this.path,
    computation: () => false,
  });
  readonly formatBytes = formatBytes;

  constructor() {
    effect((cleanup) => {
      const result = this.image.hasValue() ? this.image.value() : null;
      const url = result ? URL.createObjectURL(result.blob) : null;
      this.imageUrl.set(url);
      cleanup(() => {
        if (url) URL.revokeObjectURL(url);
      });
    });
  }

  async copyPath() {
    try {
      await navigator.clipboard.writeText(this.path());
      this.copyStatus.set('Path copied');
    } catch {
      this.copyStatus.set('Unable to copy path');
    }
  }
}
