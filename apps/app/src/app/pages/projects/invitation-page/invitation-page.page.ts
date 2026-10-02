import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectQuery, QueryClient } from '@tanstack/angular-query';
import { environment } from '../../../../environments/environment';
import {
  injectAuthClient,
  injectAuthSessionId,
  injectAuthUser,
} from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';

@Component({
  selector: 'app-invitation-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    HlmButtonImports,
    HlmCardImports,
    HlmSpinnerImports,
  ],
  template: `
    <div class="mx-auto w-full max-w-xl p-4 md:py-16">
      <section hlmCard>
        <div hlmCardHeader>
          <h1 hlmCardTitle>Project invitation</h1>
          <p hlmCardDescription>Signed in as {{ user()?.email }}</p>
        </div>
        <div hlmCardContent class="grid gap-4">
          @if (user() && !user()?.emailVerified) {
            <p>
              Verify {{ user()?.email }} before accepting project invitations.
            </p>
            <p class="text-muted-foreground text-sm">
              We'll send a verification link to your inbox. Use the email
              address this invitation was sent to.
            </p>
            <button hlmBtn [disabled]="busy()" (click)="sendVerification()">
              @if (busy()) {
                <hlm-spinner />
              }
              {{
                verificationSent()
                  ? 'Send another verification email'
                  : 'Send verification email'
              }}
            </button>
            @if (verificationSent()) {
              <p role="status" class="text-muted-foreground text-sm">
                Check your inbox, then follow the link to return to this
                invitation.
              </p>
            }
          } @else if (invitation.isPending()) {
            <hlm-spinner aria-label="Loading invitation" />
          } @else if (invitation.isError()) {
            <p role="alert">{{ invitation.error().message }}</p>
            <p class="text-muted-foreground text-sm">
              The link may have expired or been used. Make sure you're signed in
              with the invited email address, or ask a project admin for a new
              invitation.
            </p>
            <a hlmBtn variant="outline" routerLink="/projects"
              >Go to projects</a
            >
          } @else if (invitation.data(); as invite) {
            <p class="text-xl font-semibold">
              Join {{ invite.organizationName }}
            </p>
            <p>You've been invited as a {{ invite.role }}.</p>
            <p class="text-muted-foreground text-sm">
              Expires {{ invite.expiresAt | date: 'medium' }}
            </p>
            <button hlmBtn [disabled]="busy()" (click)="accept()">
              @if (busy()) {
                <hlm-spinner />
              }
              Accept invitation
            </button>
            <a hlmBtn variant="ghost" routerLink="/projects">Decide later</a>
          }
        </div>
      </section>
    </div>
  `,
})
export class InvitationPage {
  readonly invitationId = input.required<string>();
  private readonly auth = injectAuthClient();
  private readonly sessionId = injectAuthSessionId();
  private readonly router = inject(Router);
  private readonly queryClient = inject(QueryClient);
  readonly user = injectAuthUser();
  readonly busy = signal(false);
  readonly verificationSent = signal(false);
  readonly invitation = injectQuery(() => ({
    queryKey: ['invitation', this.sessionId(), this.invitationId()],
    enabled: !!this.sessionId() && !!this.user()?.emailVerified,
    retry: false,
    queryFn: async () =>
      unwrapAuthResult(
        await this.auth.organization.getInvitation({
          query: { id: this.invitationId() },
        }),
      ),
  }));

  async sendVerification() {
    const email = this.user()?.email;
    if (!email || this.busy()) return;
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
      this.verificationSent.set(true);
      toast.success('Verification email sent.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not send verification email.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  async accept() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const result = unwrapAuthResult(
        await this.auth.organization.acceptInvitation({
          invitationId: this.invitationId(),
        }),
      );
      await this.queryClient.invalidateQueries({
        queryKey: ['projects', this.sessionId()],
      });
      toast.success('You joined the project.');
      await this.router.navigate(['/projects', result.member.organizationId]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not accept the invitation.',
      );
      await this.invitation.refetch();
    } finally {
      this.busy.set(false);
    }
  }
}
