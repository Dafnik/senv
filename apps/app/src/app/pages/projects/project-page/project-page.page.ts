import { Breadcrumbs } from '../../../ui/breadcrumbs';
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
import { Router } from '@angular/router';
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
import { DeploymentHistory } from '../deployment-history';
import { ProjectDeployments } from '../project-deployments/project-deployments';
import { ProjectArtifacts } from '../project-artifacts/project-artifacts';
import { ProjectDeploymentSettings } from '../project-deployment-settings/project-deployment-settings';

@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Breadcrumbs,
    HlmAvatarImports,
    InitialsPipe,
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
    ProjectDeployments,
    ProjectArtifacts,
    DeploymentHistory,
    ProjectDeploymentSettings,
  ],
  templateUrl: './project-page.page.html',
})
export class ProjectPage {
  readonly projectSlug = input.required<string>();
  readonly redeploy = input('');
  private readonly projects = inject(ProjectsData);
  private readonly router = inject(Router);
  readonly section = input<ProjectSection>('deployments');
  private readonly sessionId = injectAuthSessionId();
  readonly user = injectAuthUser();
  readonly busy = signal(false);
  readonly project = injectQuery(() =>
    this.projects.bySlug(this.sessionId(), this.projectSlug()),
  );
  readonly projectId = computed(() => this.project.data()?.id ?? '');
  readonly breadcrumbs = computed(() => [
    { label: 'Projects', link: ['/projects'] },
    { label: this.project.data()?.name ?? this.projectSlug() },
  ]);
  readonly myRole = computed(
    () =>
      this.project.data()?.members.find((m) => m.userId === this.user()?.id)
        ?.role,
  );
  readonly isAdmin = computed(
    () => this.user()?.role === 'admin' || this.myRole() === 'admin',
  );
  readonly canManageDeployments = computed(
    () =>
      this.user()?.role === 'admin' ||
      this.myRole() === 'admin' ||
      this.myRole() === 'developer',
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
      void this.router.navigate(['/projects', this.projectSlug(), section]);
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
