import { TitleCasePipe } from '@angular/common';
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
import { Router, RouterLink } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery } from '@tanstack/angular-query';
import { environment } from '../../../../environments/environment';
import {
  injectAuthClient,
  injectAuthSessionId,
  injectAuthUser,
  injectLogout,
} from '../../../auth/auth-client';
import { ProjectsData } from '../../../queries/projects';
import { unwrapAuthResult } from '../../../auth/auth-result';
import { isPermanentInvitationError } from './invitation-error';

@Component({
  selector: 'app-invitation-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TitleCasePipe,
    DatePipe,
    RouterLink,
    HlmButtonImports,
    HlmCardImports,
    HlmSpinnerImports,
  ],
  templateUrl: './invitation-page.page.html',
})
export class InvitationPage {
  readonly invitationId = input.required<string>();
  private readonly auth = injectAuthClient();
  private readonly logout = injectLogout();
  private readonly sessionId = injectAuthSessionId();
  private readonly scopeIdentity = computed(() => ({
    invitationId: this.invitationId(),
    sessionId: this.sessionId(),
  }));
  private readonly router = inject(Router);
  private readonly projects = inject(ProjectsData);
  readonly user = injectAuthUser();
  readonly busy = linkedSignal(() => {
    this.scopeIdentity();
    return false;
  });
  private readonly operation = signal(0);
  readonly accepted = linkedSignal(() => {
    this.scopeIdentity();
    return false;
  });
  readonly verificationSent = linkedSignal(() => {
    this.scopeIdentity();
    return false;
  });
  readonly invitation = injectQuery(() => ({
    queryKey: ['invitation', this.sessionId(), this.invitationId()],
    enabled: !!this.sessionId() && !!this.user()?.emailVerified,
    retry: false,
    queryFn: () => this.projects.invitation(this.invitationId()),
  }));

  isPermanentInvitationError(): boolean {
    return isPermanentInvitationError(this.invitation.error());
  }

  async useAnotherAccount() {
    if (this.busy()) return;
    const operation = this.operation() + 1;
    this.operation.set(operation);
    const scopeIdentity = this.scopeIdentity();
    const invitationId = this.invitationId();
    const sessionId = this.sessionId();
    const isCurrent = () =>
      operation === this.operation() &&
      scopeIdentity === this.scopeIdentity() &&
      invitationId === this.invitationId() &&
      sessionId === this.sessionId();
    this.busy.set(true);
    try {
      await this.logout(
        `/invitations/${encodeURIComponent(this.invitationId())}`,
      );
    } catch (error) {
      if (isCurrent())
        toast.error(
          error instanceof Error ? error.message : 'Could not switch accounts.',
        );
    } finally {
      if (isCurrent()) this.busy.set(false);
    }
  }

  async sendVerification() {
    const email = this.user()?.email;
    if (!email || this.busy()) return;
    const operation = this.operation() + 1;
    this.operation.set(operation);
    const scopeIdentity = this.scopeIdentity();
    const invitationId = this.invitationId();
    const sessionId = this.sessionId();
    const isCurrent = () =>
      operation === this.operation() &&
      scopeIdentity === this.scopeIdentity() &&
      invitationId === this.invitationId() &&
      sessionId === this.sessionId();
    this.busy.set(true);
    try {
      unwrapAuthResult(
        await this.auth.sendVerificationEmail({
          email,
          callbackURL: new URL(
            `/invitations/${encodeURIComponent(this.invitationId())}`,
            environment.baseUrl,
          ).href,
        }),
      );
      if (isCurrent()) {
        this.verificationSent.set(true);
        toast.success('Verification email sent.');
      }
    } catch (error) {
      if (isCurrent())
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not send verification email.',
        );
    } finally {
      if (isCurrent()) this.busy.set(false);
    }
  }

  async accept() {
    if (this.busy()) return;
    const operation = this.operation() + 1;
    this.operation.set(operation);
    const scopeIdentity = this.scopeIdentity();
    this.busy.set(true);
    const invitationId = this.invitationId();
    const sessionId = this.sessionId();
    const isCurrent = () =>
      operation === this.operation() &&
      scopeIdentity === this.scopeIdentity() &&
      this.invitationId() === invitationId &&
      this.sessionId() === sessionId;
    let committed = false;
    try {
      const result = unwrapAuthResult(
        await this.auth.organization.acceptInvitation({
          invitationId,
        }),
      );
      committed = true;
      if (isCurrent()) this.accepted.set(true);
      await this.projects.invalidate(sessionId, result.member.organizationId);
      if (!isCurrent()) return;
      const project = await this.projects
        .detail(sessionId, result.member.organizationId)
        .queryFn({ signal: new AbortController().signal });
      if (!isCurrent()) return;
      await this.router.navigate(['/projects', project.previewSlug]);
      if (!isCurrent()) return;
      toast.success('You joined the project.');
    } catch (error) {
      if (!committed && isCurrent()) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not accept the invitation.',
        );
        await this.invitation.refetch();
      }
    } finally {
      if (isCurrent()) this.busy.set(false);
    }
  }
}
