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
  apply,
  form,
  FormRoot,
  FormField,
  submit,
  maxLength,
  pattern,
  required,
  schema,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
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
import { projectNameSchema } from '../../../tools/form-validation';
import { type TrpcService } from '../../../trpc/trpc.service';

type ProjectListPage = Awaited<
  ReturnType<TrpcService['client']['projects']['list']['query']>
>;

const projectCreationSchema = schema<{
  name: string;
  previewSlug: string;
}>((path) => {
  apply(path.name, projectNameSchema);
  required(path.previewSlug, { message: 'Enter a preview slug.' });
  maxLength(path.previewSlug, 63, { message: 'Use 63 characters or fewer.' });
  pattern(path.previewSlug, /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: 'Use lowercase letters, digits, and internal hyphens.',
  });
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
  template: `
    <div class="mx-auto grid w-full max-w-6xl gap-8 p-4 md:p-8">
      <header>
        <h1 class="text-3xl font-semibold tracking-tight">Projects</h1>
        <p class="text-muted-foreground mt-2">Your team's shared workspaces.</p>
      </header>
      <div class="grid items-start gap-8 lg:grid-cols-[1fr_320px]">
        <section aria-label="Your projects" class="grid gap-3">
          @if (projects.isPending()) {
            <hlm-spinner aria-label="Loading projects" />
          } @else if (projects.isError() && !projectItems().length) {
            <p role="alert">{{ projects.error().message }}</p>
            <button hlmBtn variant="outline" (click)="projects.refetch()">
              Try again
            </button>
          } @else if (projectItems().length) {
            <cdk-virtual-scroll-viewport
              [itemSize]="96"
              [minBufferPx]="288"
              [maxBufferPx]="576"
              class="h-[65vh] max-h-[640px] w-full"
              role="list"
              aria-label="Your projects"
              tabindex="0"
            >
              <div
                *cdkVirtualFor="
                  let project of projectItems();
                  let index = index;
                  trackBy: trackProject
                "
                class="h-24 pb-3"
                role="listitem"
                [attr.aria-posinset]="index + 1"
                [attr.aria-setsize]="-1"
              >
                <a
                  [routerLink]="['/projects', project.previewSlug]"
                  class="hover:bg-muted focus-visible:ring-ring flex h-full items-center gap-4 rounded-lg border px-5 transition-colors focus-visible:ring-2"
                >
                  <hlm-avatar size="lg" aria-hidden="true">
                    <span hlmAvatarFallback>{{ project.name | initials }}</span>
                  </hlm-avatar>
                  <div class="grid min-w-0 gap-2">
                    <span
                      class="truncate text-lg font-medium"
                      [title]="project.name"
                      >{{ project.name }}</span
                    >
                    <span class="text-muted-foreground font-mono text-xs">{{
                      project.id
                    }}</span>
                  </div>
                </a>
              </div>
            </cdk-virtual-scroll-viewport>
            @if (projects.isFetchingNextPage()) {
              <p
                role="status"
                class="text-muted-foreground flex items-center gap-2 text-sm"
              >
                <hlm-spinner /> Loading more projects
              </p>
            } @else if (projects.isFetchNextPageError()) {
              <p role="alert">{{ projects.error()?.message }}</p>
              <button
                hlmBtn
                variant="outline"
                (click)="projects.fetchNextPage()"
              >
                Try loading more again
              </button>
            } @else if (!projects.hasNextPage()) {
              <p class="text-muted-foreground text-sm">
                All {{ projectItems().length }} projects loaded.
              </p>
            }
          } @else {
            <div hlmEmpty class="border">
              <div hlmEmptyHeader>
                <h2 hlmEmptyTitle>No projects yet</h2>
                <p hlmEmptyDescription>
                  Create a project to start working with your team, or accept an
                  invitation from your email.
                </p>
              </div>
            </div>
          }
        </section>
        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle>Create a project</h2>
            <p hlmCardDescription>Choose a name. You'll be its first admin.</p>
          </div>
          <form
            hlmCardContent
            class="grid gap-4"
            [formRoot]="projectForm"
            (submit)="create($event)"
          >
            <div hlmField>
              <label hlmFieldLabel for="project-name">Project name</label>
              <input
                hlmInput
                id="project-name"
                autocomplete="off"
                placeholder="My project"
                [formField]="projectForm.name"
              />
              @if (projectForm.name().touched()) {
                @for (error of projectForm.name().errors(); track error) {
                  <hlm-field-error>{{ error.message }}</hlm-field-error>
                }
              }
            </div>
            <div hlmField>
              <label hlmFieldLabel for="project-preview-slug"
                >Preview slug</label
              >
              <input
                hlmInput
                id="project-preview-slug"
                autocomplete="off"
                spellcheck="false"
                placeholder="my-project"
                [formField]="projectForm.previewSlug"
                (input)="markSlugEdited()"
              />
              <p hlmFieldDescription>
                Used in preview addresses. Suggested from the project name and
                editable before creation.
              </p>
              @if (projectForm.previewSlug().touched()) {
                @for (
                  error of projectForm.previewSlug().errors();
                  track error
                ) {
                  <hlm-field-error>{{ error.message }}</hlm-field-error>
                }
              }
            </div>
            <button
              hlmBtn
              type="submit"
              [disabled]="busy() || projectForm().invalid()"
            >
              @if (busy()) {
                <hlm-spinner />
              }
              Create project
            </button>
          </form>
        </section>
      </div>
    </div>
  `,
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
