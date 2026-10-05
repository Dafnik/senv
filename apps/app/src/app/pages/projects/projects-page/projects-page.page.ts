import {
  CdkVirtualScrollViewport,
  ScrollingModule,
} from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  untracked,
  viewChild,
  inject,
  signal,
} from '@angular/core';
import {
  MAX_LENGTH,
  PATTERN,
  REQUIRED,
  form,
  FormRoot,
  FormField,
  metadata,
  submit,
  schema,
  validateStandardSchema,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import * as z from 'zod';
import {
  previewSlugSchema,
  projectNameMaxLength,
  projectNameSchema,
} from '@senv/api/shared/validation';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { InitialsPipe } from '../../../ui/initials-pipe';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectInfiniteQuery, injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { ProjectsData } from '../../../queries/projects';
import { type TrpcService } from '../../../trpc/trpc.service';

type ProjectListPage = Awaited<
  ReturnType<TrpcService['client']['projects']['list']['query']>
>;

const projectCreationValueSchema = z.object({
  name: projectNameSchema,
  previewSlug: previewSlugSchema,
});

const projectCreationSchema = schema<{
  name: string;
  previewSlug: string;
}>((path) => {
  metadata(path.name, REQUIRED, () => true);
  metadata(path.name, MAX_LENGTH, () => projectNameMaxLength);
  metadata(path.previewSlug, REQUIRED, () => true);
  metadata(path.previewSlug, MAX_LENGTH, () => 63);
  metadata(
    path.previewSlug,
    PATTERN,
    () => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  );
  validateStandardSchema(path, projectCreationValueSchema);
});

@Component({
  selector: 'app-projects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormField,
    FormRoot,
    ScrollingModule,
    HlmButtonImports,
    HlmAvatarImports,
    InitialsPipe,
    HlmCardImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
  ],
  templateUrl: './projects-page.page.html',
})
export class ProjectsPage {
  private readonly projectData = inject(ProjectsData);
  private readonly sessionId = injectAuthSessionId();
  private readonly router = inject(Router);
  private readonly model = signal({ name: '', previewSlug: '' });
  private readonly slugEdited = signal(false);
  readonly busy = signal(false);
  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  readonly projectForm = form(this.model, projectCreationSchema);
  readonly projects = injectInfiniteQuery(() =>
    this.projectData.list(this.sessionId()),
  );
  private readonly slugSuggestion = injectQuery(() =>
    this.projectData.previewSlugSuggestion(
      this.sessionId(),
      this.model().name.trim(),
    ),
  );
  readonly projectItems = computed(
    () => this.projects.data()?.pages.flatMap((page) => page.projects) ?? [],
  );
  readonly trackProject = (
    _: number,
    project: ProjectListPage['projects'][number],
  ) => project.id;

  constructor() {
    effect(() => {
      const name = this.model().name.trim();
      const suggestion = this.slugSuggestion.data();
      if (
        name &&
        suggestion?.name === name &&
        !this.slugEdited() &&
        this.model().previewSlug !== suggestion.previewSlug
      ) {
        this.model.update((current) => ({
          ...current,
          previewSlug: suggestion.previewSlug,
        }));
      }
    });
    // Reconnect when the viewport appears or another page changes the rendered range.
    effect((onCleanup) => {
      const viewport = this.viewport();
      this.projectItems();
      if (!viewport) return;
      const subscription = viewport.renderedRangeStream.subscribe((range) =>
        untracked(() => this.loadMore(range.end)),
      );
      onCleanup(() => subscription.unsubscribe());
      untracked(() => this.loadMore(viewport.getRenderedRange().end));
    });
  }

  markSlugEdited() {
    this.slugEdited.set(true);
  }
  loadMore(renderedEnd: number) {
    if (
      renderedEnd > 0 &&
      renderedEnd >= this.projectItems().length - 10 &&
      this.projects.hasNextPage() &&
      !this.projects.isFetching() &&
      !this.projects.isFetchNextPageError()
    ) {
      void this.projects.fetchNextPage();
    }
  }

  create(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    void submit(this.projectForm, async () => {
      this.busy.set(true);
      try {
        const project = await this.projectData.create(
          this.model().name.trim(),
          this.model().previewSlug.trim(),
        );
        await this.projects.refetch();
        await this.router.navigate(['/projects', project.previewSlug]);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not create the project.',
        );
      } finally {
        this.busy.set(false);
      }
    });
  }
}
