import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId, injectAuthUser } from '../../auth/auth-client';
import { ProjectsData } from '../../queries/projects';
import { DeploymentsData } from '../../queries/deployments';
import { Breadcrumbs, type BreadcrumbItem } from '../../ui/breadcrumbs';
import { DeploymentLogs } from './deployment-logs';
import { DeploymentOverview } from './deployment-overview';

@Component({
  selector: 'app-deployment-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    HlmButtonImports,
    HlmSpinnerImports,
    Breadcrumbs,
    DeploymentLogs,
    DeploymentOverview,
  ],
  template: `
    <div class="mx-auto grid w-full max-w-6xl gap-6 p-4 md:p-8">
      <app-breadcrumbs [items]="breadcrumbs()" />
      @if (project.isPending() || (project.isSuccess() && detail.isPending())) {
        <hlm-spinner aria-label="Loading deployment" />
      } @else if (project.isError()) {
        <p role="alert">{{ project.error().message }}</p>
        <a hlmBtn variant="outline" routerLink="/projects" class="w-fit"
          >Back to projects</a
        >
      } @else if (detail.isError()) {
        <p role="alert">{{ detail.error().message }}</p>
        <a
          hlmBtn
          variant="outline"
          [routerLink]="['/projects', projectSlug(), 'deployments']"
          class="w-fit"
          >Back to deployments</a
        >
      } @else if (detail.data(); as deployment) {
        @if (view() === 'logs') {
          <app-deployment-logs
            [projectId]="deployment.projectId"
            [deploymentId]="deployment.id"
            [source]="source()"
          />
        } @else {
          <app-deployment-overview
            [projectSlug]="projectSlug()"
            [canManage]="canManage()"
            [isAdmin]="isAdmin()"
            [deployment]="deployment"
            [history]="deployment.history"
          />
        }
      }
    </div>
  `,
})
export class DeploymentDetail {
  readonly projectSlug = input.required<string>();
  readonly deploymentId = input.required<string>();
  readonly view = input('overview');
  readonly source = input('origin');
  private readonly projects = inject(ProjectsData);
  private readonly data = inject(DeploymentsData);
  private readonly sessionId = injectAuthSessionId();
  private readonly user = injectAuthUser();
  readonly project = injectQuery(() =>
    this.projects.bySlug(this.sessionId(), this.projectSlug()),
  );
  readonly detail = injectQuery(() =>
    this.data.detail(
      this.sessionId(),
      this.project.data()?.id ?? '',
      this.deploymentId(),
    ),
  );
  private readonly role = computed(
    () =>
      this.project
        .data()
        ?.members.find((member) => member.userId === this.user()?.id)?.role,
  );
  readonly isAdmin = computed(
    () => this.user()?.role === 'admin' || this.role() === 'admin',
  );
  readonly canManage = computed(
    () => this.isAdmin() || this.role() === 'developer',
  );
  readonly detailLink = computed(() => [
    '/projects',
    this.projectSlug(),
    'deployments',
    this.deploymentId(),
  ]);
  readonly breadcrumbs = computed<BreadcrumbItem[]>(() => [
    { label: 'Projects', link: ['/projects'] },
    {
      label: this.project.data()?.name ?? this.projectSlug(),
      link: ['/projects', this.projectSlug(), 'deployments'],
    },
    {
      label: this.deploymentId(),
      ...(this.view() === 'logs' ? { link: this.detailLink() } : {}),
    },
    ...(this.view() === 'logs' ? [{ label: 'Logs' }] : []),
  ]);
}
