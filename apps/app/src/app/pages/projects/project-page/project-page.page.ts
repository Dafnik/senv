import { DatePipe } from '@angular/common';
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
  email,
  form,
  FormField,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { ProjectRole } from '@senv/api/shared/project-permissions';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { injectQuery, QueryClient } from '@tanstack/angular-query';
import {
  injectAuthClient,
  injectAuthSessionId,
  injectAuthUser,
} from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';

@Component({
  selector: 'app-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    FormField,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmDropdownMenuImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    HlmToggleGroupImports,
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
            @if (isAdmin()) {
              <section class="grid gap-4" aria-labelledby="invitations-heading">
                <h2 id="invitations-heading" class="text-lg font-semibold">
                  Invitations
                </h2>
                <ul class="divide-y rounded-lg border">
                  @for (
                    invitation of current.invitations;
                    track invitation.id
                  ) {
                    <li
                      class="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div>
                        <p class="text-sm font-medium break-all">
                          {{ invitation.email }}
                        </p>
                        <p class="text-muted-foreground text-xs">
                          {{ invitation.role }} · {{ invitation.status }} ·
                          Expires {{ invitation.expiresAt | date: 'medium' }}
                        </p>
                      </div>
                      @if (invitation.status === 'pending') {
                        <button
                          hlmBtn
                          variant="ghost"
                          size="sm"
                          [disabled]="busy()"
                          (click)="cancelInvitation(invitation.id)"
                        >
                          Cancel
                        </button>
                      }
                    </li>
                  } @empty {
                    <li class="text-muted-foreground p-4 text-sm">
                      No invitations yet.
                    </li>
                  }
                </ul>
              </section>
            }
          </div>
          @if (isAdmin()) {
            <div class="grid gap-6">
              <section hlmCard>
                <div hlmCardHeader>
                  <h2 hlmCardTitle>Invite a teammate</h2>
                  <p hlmCardDescription>
                    Send a link that expires in seven days.
                  </p>
                </div>
                <form
                  hlmCardContent
                  class="grid gap-4"
                  (submit)="invite($event)"
                >
                  <div hlmField>
                    <label hlmFieldLabel for="invite-email"
                      >Email address</label
                    >
                    <input
                      hlmInput
                      id="invite-email"
                      type="email"
                      autocomplete="email"
                      placeholder="teammate@example.com"
                      [formField]="inviteForm.email"
                    />
                    @if (inviteForm.email().touched()) {
                      @for (error of inviteForm.email().errors(); track error) {
                        <hlm-field-error>{{ error.message }}</hlm-field-error>
                      }
                    }
                  </div>
                  <div hlmField>
                    <span hlmFieldLabel id="role-label">Project role</span>
                    <hlm-toggle-group
                      type="single"
                      variant="outline"
                      [nullable]="false"
                      [value]="inviteRole()"
                      (valueChange)="selectRole($event)"
                      aria-labelledby="role-label"
                    >
                      <button hlmToggleGroupItem type="button" value="viewer">
                        Viewer
                      </button>
                      <button
                        hlmToggleGroupItem
                        type="button"
                        value="developer"
                      >
                        Developer
                      </button>
                      <button hlmToggleGroupItem type="button" value="admin">
                        Admin
                      </button>
                    </hlm-toggle-group>
                    <p hlmFieldDescription>
                      Only admins can change project settings and manage
                      members.
                    </p>
                  </div>
                  <button
                    hlmBtn
                    type="submit"
                    [disabled]="busy() || inviteForm().invalid()"
                  >
                    @if (busy()) {
                      <hlm-spinner />
                    }
                    Send invitation
                  </button>
                </form>
              </section>
              <section hlmCard>
                <div hlmCardHeader>
                  <h2 hlmCardTitle>Project settings</h2>
                  <p hlmCardDescription>
                    The project ID stays the same when you rename it.
                  </p>
                </div>
                <form
                  hlmCardContent
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
  readonly roles: ProjectRole[] = ['viewer', 'developer', 'admin'];
  readonly busy = signal(false);
  readonly inviteRole = signal<ProjectRole>('viewer');
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
  readonly nameForm = form(this.nameModel, (p) => {
    required(p.name, { message: 'Enter a project name.' });
    maxLength(p.name, 100, { message: 'Use 100 characters or fewer.' });
  });
  private readonly inviteModel = signal({ email: '' });
  readonly inviteForm = form(this.inviteModel, (p) => {
    required(p.email, { message: 'Enter an email address.' });
    email(p.email, { message: 'Enter a valid email address.' });
  });

  selectRole(value: unknown) {
    if (value === 'viewer' || value === 'developer' || value === 'admin')
      this.inviteRole.set(value);
  }

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

  invite(event: Event) {
    event.preventDefault();
    void submit(this.inviteForm, async () => {
      await this.perform(async () => {
        unwrapAuthResult(
          await this.auth.organization.inviteMember({
            organizationId: this.projectId(),
            email: this.inviteModel().email.trim(),
            role: this.inviteRole(),
          }),
        );
        this.inviteModel.set({ email: '' });
        this.inviteForm().reset();
      }, 'Invitation sent.');
    });
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

  cancelInvitation(invitationId: string) {
    void this.perform(
      async () =>
        unwrapAuthResult(
          await this.auth.organization.cancelInvitation({ invitationId }),
        ),
      'Invitation cancelled.',
    );
  }
}
