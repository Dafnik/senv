import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft } from '@ng-icons/lucide';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { InitialsPipe } from '../../../ui/initials-pipe';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import {
  apply,
  form,
  FormField,
  FormRoot,
  submit,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { type ProjectRole } from '@senv/api/shared/project-permissions';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId, injectAuthUser } from '../../../auth/auth-client';
import { ProjectsData } from '../../../queries/projects';
import { projectNameSchema } from '../../../tools/form-validation';
import { ProjectInvitations } from '../project-invitations/project-invitations';
import { isProjectSection, type ProjectSection } from '../project-sections';
import { ProjectMembers } from '../project-members/project-members';

@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgIcon,
    HlmAvatarImports,
    InitialsPipe,
    RouterLink,
    FormField,
    FormRoot,
    HlmButtonImports,
    HlmCardImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    HlmTabsImports,
    ProjectInvitations,
    ProjectMembers,
  ],
  providers: [provideIcons({ lucideArrowLeft })],
  template: `
    <div class="mx-auto grid w-full max-w-6xl gap-8 p-4 md:p-8">
      <a
        routerLink="/projects"
        class="text-muted-foreground flex w-fit items-center gap-2 text-sm hover:underline"
        ><ng-icon name="lucideArrowLeft" />Back to projects</a
      >
      @if (project.isPending()) {
        <hlm-spinner aria-label="Loading project" />
      } @else if (project.isError()) {
        <p role="alert">{{ project.error().message }}</p>
        <button hlmBtn variant="outline" (click)="project.refetch()">
          Try again
        </button>
      } @else if (project.data(); as current) {
        <header class="flex items-center gap-4">
          <hlm-avatar size="lg" aria-hidden="true">
            <span hlmAvatarFallback>{{ current.name | initials }}</span>
          </hlm-avatar>
          <div class="min-w-0">
            <h1 class="text-3xl font-semibold tracking-tight break-words">
              {{ current.name }}
            </h1>
          </div>
        </header>
        <hlm-tabs
          [tab]="section()"
          (tabActivated)="selectSection($event)"
          class="gap-6"
        >
          <hlm-tabs-list aria-label="Project sections">
            <button hlmTabsTrigger="deployments">Deployments</button>
            <button hlmTabsTrigger="members">Members</button>
            <button hlmTabsTrigger="settings">Settings</button>
          </hlm-tabs-list>
          <div hlmTabsContent="deployments">
            <div hlmEmpty class="border">
              <div hlmEmptyHeader>
                <h2 hlmEmptyTitle>No deployments yet</h2>
                <p hlmEmptyDescription>
                  Deployments for this project will appear here.
                </p>
              </div>
            </div>
          </div>
          <div hlmTabsContent="members">
            <ng-template hlmTabsContentLazy>
              <div class="grid gap-8">
                <app-project-members
                  [projectId]="projectId()"
                  [members]="current.members"
                  [currentUserId]="user()?.id"
                  [canManage]="isAdmin()"
                  [busy]="busy()"
                  (removed)="removeMember($event)"
                  (roleChanged)="changeRole($event.memberId, $event.role)"
                />
                @if (isAdmin()) {
                  <app-project-invitations [projectId]="projectId()" />
                }
              </div>
            </ng-template>
          </div>
          <div hlmTabsContent="settings">
            <ng-template hlmTabsContentLazy>
              @if (isAdmin()) {
                <section hlmCard>
                  <div hlmCardHeader>
                    <h2 hlmCardTitle>Project settings</h2>
                    <p hlmCardDescription>
                      The project ID stays the same when you rename it.
                    </p>
                  </div>
                  <form
                    hlmCardContent
                    [formRoot]="nameForm"
                    class="grid gap-4"
                    (submit)="rename($event)"
                  >
                    <div hlmField>
                      <label hlmFieldLabel for="rename-project"
                        >Project name</label
                      >
                      <input
                        hlmInput
                        id="rename-project"
                        [formField]="nameForm.name"
                      />
                      @if (nameForm.name().touched()) {
                        @for (error of nameForm.name().errors(); track error) {
                          <hlm-field-error>{{ error.message }}</hlm-field-error>
                        }
                      }
                    </div>
                    @if (remoteNameChanged()) {
                      <div role="status" class="grid gap-2">
                        <p>
                          The project was renamed to “{{ current.name }}” while
                          you were editing. Your draft is preserved. Save to use
                          your draft, or load the current name.
                        </p>
                        <button
                          hlmBtn
                          type="button"
                          variant="outline"
                          (click)="loadCurrentName()"
                        >
                          Load current name
                        </button>
                      </div>
                    }
                    <button
                      hlmBtn
                      variant="outline"
                      type="submit"
                      [disabled]="
                        busy() ||
                        nameForm().invalid() ||
                        nameForm.name().value().trim() === current.name
                      "
                    >
                      Save name
                    </button>
                  </form>
                </section>
              } @else {
                <section hlmCard>
                  <div hlmCardHeader>
                    <h2 hlmCardTitle>Project settings</h2>
                    <p hlmCardDescription>
                      Only project admins can change settings.
                    </p>
                  </div>
                  <dl hlmCardContent class="grid gap-4">
                    <div>
                      <dt class="text-muted-foreground">Project name</dt>
                      <dd>{{ current.name }}</dd>
                    </div>
                    <div>
                      <dt class="text-muted-foreground">Project ID</dt>
                      <dd class="font-mono break-all">{{ current.id }}</dd>
                    </div>
                  </dl>
                </section>
              }
            </ng-template>
          </div>
        </hlm-tabs>
      }
    </div>
  `,
})
export class ProjectPage {
  readonly projectId = input.required<string>();
  private readonly projects = inject(ProjectsData);
  private readonly router = inject(Router);
  readonly section = input<ProjectSection>('deployments');
  private readonly sessionId = injectAuthSessionId();
  readonly user = injectAuthUser();
  readonly busy = signal(false);
  readonly project = injectQuery(() =>
    this.projects.detail(this.sessionId(), this.projectId()),
  );
  readonly myRole = computed(
    () =>
      this.project.data()?.members.find((m) => m.userId === this.user()?.id)
        ?.role,
  );
  readonly isAdmin = computed(
    () => this.user()?.role === 'admin' || this.myRole() === 'admin',
  );
  private readonly nameModel = linkedSignal({
    source: () => ({
      id: this.projectId(),
      name: this.project.data()?.name ?? '',
    }),
    computation: (source, previous): { name: string; originalName: string } => {
      if (
        previous?.source.id === source.id &&
        previous.value.name !== previous.value.originalName
      )
        return previous.value;
      return { name: source.name, originalName: source.name };
    },
  });
  readonly remoteNameChanged = computed(
    () =>
      this.nameModel().name !== this.nameModel().originalName &&
      this.project.data()?.name !== this.nameModel().originalName,
  );
  selectSection(section: string) {
    if (isProjectSection(section))
      void this.router.navigate(['/projects', this.projectId(), section]);
  }
  loadCurrentName() {
    const name = this.project.data()?.name ?? '';
    this.nameModel.set({ name, originalName: name });
    this.nameForm().reset();
  }
  readonly nameForm = form(this.nameModel, (p) =>
    apply(p.name, projectNameSchema),
  );

  private async perform(action: () => Promise<unknown>, message: string) {
    if (this.busy()) return false;
    this.busy.set(true);
    const projectId = this.projectId();
    const sessionId = this.sessionId();
    try {
      await action();
      await this.projects.invalidate(sessionId, projectId);
      toast.success(message);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'The request failed. Please try again.',
      );
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  rename(event: Event) {
    event.preventDefault();
    void submit(this.nameForm, async () => {
      const name = this.nameModel().name.trim();
      const projectId = this.projectId();
      if (
        (await this.perform(
          () => this.projects.rename(this.projectId(), name),
          'Project renamed.',
        )) &&
        projectId === this.projectId()
      ) {
        this.nameModel.set({ name, originalName: name });
        this.nameForm().reset();
      }
    });
  }

  async removeMember(memberId: string) {
    const projectId = this.projectId();
    const sessionId = this.sessionId();
    const removingSelf = this.project
      .data()
      ?.members.some(
        (member) => member.id === memberId && member.userId === this.user()?.id,
      );
    if (
      await this.perform(
        () => this.projects.removeMember(projectId, memberId),
        'Member removed from the project.',
      )
    ) {
      if (
        removingSelf &&
        this.user()?.role !== 'admin' &&
        this.projectId() === projectId &&
        this.sessionId() === sessionId
      )
        await this.router.navigate(['/projects']);
    }
  }

  changeRole(memberId: string, role: ProjectRole) {
    void this.perform(
      () => this.projects.changeRole(this.projectId(), memberId, role),
      'Role updated.',
    );
  }
}
