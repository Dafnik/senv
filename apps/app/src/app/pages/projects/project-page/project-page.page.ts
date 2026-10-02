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
import { RouterLink } from '@angular/router';
import {
  projectRoleNames,
  type ProjectRole,
} from '@senv/api/shared/project-permissions';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery, QueryClient } from '@tanstack/angular-query';
import {
  injectAuthClient,
  injectAuthSessionId,
  injectAuthUser,
} from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';
import { projectNameSchema } from '../../../tools/form-validation';
import { ProjectInvitations } from '../project-invitations/project-invitations';

@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormField,
    FormRoot,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmDropdownMenuImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    ProjectInvitations,
  ],
  template: `
    <div class="mx-auto grid w-full max-w-6xl gap-8 p-4 md:p-8">
      <a
        routerLink="/projects"
        class="text-muted-foreground w-fit text-sm hover:underline"
        >Back to projects</a
      >
      @if (project.isPending()) {
        <hlm-spinner aria-label="Loading project" />
      } @else if (project.isError()) {
        <p role="alert">{{ project.error().message }}</p>
        <button hlmBtn variant="outline" (click)="project.refetch()">
          Try again
        </button>
      } @else if (project.data(); as current) {
        <header class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 class="text-3xl font-semibold tracking-tight">
              {{ current.name }}
            </h1>
            <p class="text-muted-foreground mt-2 font-mono text-xs">
              {{ current.id }}
            </p>
          </div>
          <span hlmBadge variant="secondary">{{ myRole() }}</span>
        </header>
        <div class="grid items-start gap-8 lg:grid-cols-[1fr_360px]">
          <div class="grid gap-8">
            <section class="grid gap-4" aria-labelledby="members-heading">
              <h2 id="members-heading" class="text-lg font-semibold">
                Members
                <span class="text-muted-foreground">{{
                  current.members.length
                }}</span>
              </h2>
              <ul class="divide-y rounded-lg border">
                @for (member of current.members; track member.id) {
                  <li
                    class="flex flex-wrap items-center justify-between gap-3 p-4"
                  >
                    <div class="min-w-0">
                      <p class="font-medium">
                        {{ member.user.name }}
                        @if (member.userId === user()?.id) {
                          <span class="text-muted-foreground text-sm"
                            >(you)</span
                          >
                        }
                      </p>
                      <p class="text-muted-foreground text-sm break-all">
                        {{ member.user.email }}
                      </p>
                    </div>
                    @if (isAdmin()) {
                      <button
                        hlmBtn
                        variant="outline"
                        size="sm"
                        [disabled]="busy()"
                        [hlmDropdownMenuTrigger]="rolesMenu"
                        [attr.aria-label]="
                          'Change role for ' + member.user.name
                        "
                      >
                        {{ member.role }}
                      </button>
                      <ng-template #rolesMenu>
                        <hlm-dropdown-menu>
                          @for (role of roles; track role) {
                            <button
                              hlmDropdownMenuItem
                              [disabled]="member.role === role"
                              (click)="changeRole(member.id, role)"
                            >
                              {{ role }}
                            </button>
                          }
                        </hlm-dropdown-menu>
                      </ng-template>
                    } @else {
                      <span hlmBadge variant="outline">{{ member.role }}</span>
                    }
                  </li>
                }
              </ul>
            </section>
          </div>
          @if (isAdmin()) {
            <div class="grid gap-6">
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
            </div>
          }
        </div>
        @if (isAdmin()) {
          <app-project-invitations [projectId]="projectId()" />
        }
      }
    </div>
  `,
})
export class ProjectPage {
  readonly projectId = input.required<string>();
  private readonly auth = injectAuthClient();
  private readonly sessionId = injectAuthSessionId();
  private readonly queryClient = inject(QueryClient);
  readonly user = injectAuthUser();
  readonly roles = projectRoleNames;
  readonly busy = signal(false);
  readonly project = injectQuery(() => ({
    queryKey: ['project', this.sessionId(), this.projectId()],
    enabled: !!this.sessionId(),
    queryFn: async () =>
      unwrapAuthResult(
        await this.auth.organization.getFullOrganization({
          query: { organizationId: this.projectId() },
        }),
      ),
  }));
  readonly myRole = computed(
    () =>
      this.project.data()?.members.find((m) => m.userId === this.user()?.id)
        ?.role,
  );
  readonly isAdmin = computed(() => this.myRole() === 'admin');
  private readonly nameModel = linkedSignal(() => ({
    name: this.project.data()?.name ?? '',
  }));
  readonly nameForm = form(this.nameModel, (p) =>
    apply(p.name, projectNameSchema),
  );

  private async perform(action: () => Promise<unknown>, message: string) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await action();
      await this.project.refetch();
      await this.queryClient.invalidateQueries({
        queryKey: ['projects', this.sessionId()],
      });
      toast.success(message);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'The request failed. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  rename(event: Event) {
    event.preventDefault();
    void submit(this.nameForm, async () => {
      await this.perform(
        async () =>
          unwrapAuthResult(
            await this.auth.organization.update({
              organizationId: this.projectId(),
              data: { name: this.nameModel().name.trim() },
            }),
          ),
        'Project renamed.',
      );
    });
  }

  changeRole(memberId: string, role: ProjectRole) {
    void this.perform(
      async () =>
        unwrapAuthResult(
          await this.auth.organization.updateMemberRole({
            organizationId: this.projectId(),
            memberId,
            role,
          }),
        ),
      'Role updated.',
    );
  }
}
