import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import {
  injectAuthClient,
  injectAuthSessionId,
} from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';

@Component({
  selector: 'app-projects-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormField,
    HlmButtonImports,
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
          } @else if (projects.isError()) {
            <p role="alert">{{ projects.error().message }}</p>
            <button hlmBtn variant="outline" (click)="projects.refetch()">
              Try again
            </button>
          } @else {
            @for (project of projects.data(); track project.id) {
              <a
                [routerLink]="['/projects', project.id]"
                class="hover:bg-muted focus-visible:ring-ring flex flex-col gap-2 rounded-lg border p-5 transition-colors focus-visible:ring-2"
              >
                <span class="text-lg font-medium">{{ project.name }}</span>
                <span class="text-muted-foreground font-mono text-xs">{{
                  project.id
                }}</span>
              </a>
            } @empty {
              <div hlmEmpty class="border">
                <div hlmEmptyHeader>
                  <h2 hlmEmptyTitle>No projects yet</h2>
                  <p hlmEmptyDescription>
                    Create a project to start working with your team, or accept
                    an invitation from your email.
                  </p>
                </div>
              </div>
            }
          }
        </section>
        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle>Create a project</h2>
            <p hlmCardDescription>Choose a name. You'll be its first admin.</p>
          </div>
          <form hlmCardContent class="grid gap-4" (submit)="create($event)">
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
  private readonly auth = injectAuthClient();
  private readonly sessionId = injectAuthSessionId();
  private readonly router = inject(Router);
  private readonly model = signal({ name: '' });
  readonly busy = signal(false);
  readonly projectForm = form(this.model, (p) => {
    required(p.name, { message: 'Enter a project name.' });
    maxLength(p.name, 100, { message: 'Use 100 characters or fewer.' });
  });
  readonly projects = injectQuery(() => ({
    queryKey: ['projects', this.sessionId()],
    enabled: !!this.sessionId(),
    queryFn: async () => unwrapAuthResult(await this.auth.organization.list()),
  }));

  create(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    void submit(this.projectForm, async () => {
      this.busy.set(true);
      try {
        const project = unwrapAuthResult(
          await this.auth.organization.create({
            name: this.model().name.trim(),
            // Better Auth requires a slug; the API replaces it with the generated project ID.
            slug: crypto.randomUUID(),
          }),
        );
        await this.projects.refetch();
        await this.router.navigate(['/projects', project.id]);
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
