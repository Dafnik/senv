import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCopy, lucideLink } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import { injectAuthSessionId, injectAuthUser } from '../../auth/auth-client';
import { ProjectsData } from '../../queries/projects';
import { DeploymentsData } from '../../queries/deployments';
import { Breadcrumbs, type BreadcrumbItem } from '../../ui/breadcrumbs';
import { DeploymentLogs } from './deployment-logs';
import { ProjectDeployments } from './project-deployments/project-deployments';

@Component({
  selector: 'app-deployment-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    NgIcon,
    HlmButtonImports,
    HlmSpinnerImports,
    Breadcrumbs,
    DeploymentLogs,
    ProjectDeployments,
  ],
  providers: [provideIcons({ lucideCopy, lucideLink })],
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
        <header class="flex flex-wrap items-start justify-between gap-4">
          <div class="grid gap-2">
            <p class="text-muted-foreground text-sm">
              {{ project.data()?.name }}
            </p>
            <h1 class="text-2xl font-semibold tracking-tight">
              {{ view() === 'logs' ? 'Logs' : 'Deployment' }}
              <span class="font-mono break-all">{{ deployment.id }}</span>
            </h1>
            <p class="text-muted-foreground text-sm">
              {{
                view() === 'logs'
                  ? 'Origin output and preview proxy requests.'
                  : 'Publication information, captured configuration and audit history.'
              }}
            </p>
          </div>
          @if (view() === 'logs') {
            <div class="flex flex-wrap items-center gap-2">
              <button
                hlmBtn
                variant="ghost"
                size="icon"
                type="button"
                aria-label="Copy deployment details link"
                title="Copy deployment details link"
                (click)="copyDetailsLink()"
              >
                <ng-icon name="lucideLink" />
              </button>
              @if (
                !deployment.removalPending &&
                deployment.status !== 'deleted' &&
                deployment.status !== 'cleaned'
              ) {
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon"
                  type="button"
                  aria-label="Copy preview link"
                  title="Copy preview link"
                  (click)="copyLink(deployment.previewUrl)"
                >
                  <ng-icon name="lucideCopy" />
                </button>
              }
              @if (
                deployment.status === 'healthy' && !deployment.removalPending
              ) {
                <a
                  hlmBtn
                  [href]="deployment.previewUrl"
                  target="_blank"
                  rel="noreferrer"
                  >Open preview ↗</a
                >
              }
            </div>
          }
        </header>
        <nav
          aria-label="Deployment sections"
          class="flex flex-wrap items-center gap-2 border-b pb-4"
        >
          @if (view() === 'logs') {
            <a hlmBtn variant="outline" [routerLink]="detailLink()"
              >View deployment details</a
            >
          } @else {
            <a
              hlmBtn
              variant="ghost"
              [routerLink]="[]"
              fragment="deployment-information"
              >Information</a
            >
            <a
              hlmBtn
              variant="ghost"
              [routerLink]="[]"
              fragment="deployment-configuration"
              >Configuration</a
            >
            <a
              hlmBtn
              variant="ghost"
              [routerLink]="[]"
              fragment="deployment-audit"
              >Audit log</a
            >
            <a hlmBtn variant="outline" [routerLink]="logsLink()">View logs</a>
          }
        </nav>
        @if (view() === 'logs') {
          <app-deployment-logs
            [projectId]="deployment.projectId"
            [deploymentId]="deployment.id"
            [source]="source()"
          />
        } @else {
          <app-project-deployments
            [projectId]="deployment.projectId"
            [previewSlug]="projectSlug()"
            [canManage]="canManage()"
            [isAdmin]="isAdmin()"
            [detailDeployment]="deployment"
            [detailHistory]="deployment.history"
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
  private readonly router = inject(Router);
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
  readonly logsLink = computed(() => [...this.detailLink(), 'logs']);
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
  async copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied.');
    } catch {
      toast.error('Could not copy the link.');
    }
  }
  copyDetailsLink() {
    return this.copyLink(
      new URL(
        this.router.serializeUrl(this.router.createUrlTree(this.detailLink())),
        window.location.origin,
      ).href,
    );
  }
}
