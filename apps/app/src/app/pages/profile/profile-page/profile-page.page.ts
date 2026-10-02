import { TitleCasePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { AccountPassword } from '../../../auth/account-password';
import { injectAuthUser } from '../../../auth/auth-client';
import { InitialsPipe } from '../../../ui/initials-pipe';

@Component({
  selector: 'app-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TitleCasePipe,
    HlmAvatarImports,
    HlmButtonImports,
    HlmCardImports,
    HlmSpinnerImports,
    InitialsPipe,
  ],
  template: `
    <div class="mx-auto grid w-full max-w-2xl gap-8 p-4 md:p-8">
      <h1 class="text-3xl font-semibold tracking-tight">Profile</h1>
      @if (user(); as account) {
        <section hlmCard>
          <div hlmCardHeader>
            <hlm-avatar size="lg" aria-hidden="true">
              <span hlmAvatarFallback>{{ account.name | initials }}</span>
            </hlm-avatar>
            <h2 hlmCardTitle>Account details</h2>
          </div>
          <dl hlmCardContent class="grid gap-6">
            <div>
              <dt class="text-muted-foreground text-sm">Name</dt>
              <dd>{{ account.name }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground text-sm">Email address</dt>
              <dd class="break-all">{{ account.email }}</dd>
            </div>
            <div>
              <dt class="text-muted-foreground text-sm">Instance role</dt>
              <dd>{{ account.role ?? 'user' | titlecase }}</dd>
            </div>
          </dl>
        </section>
        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle>Change password</h2>
            <p hlmCardDescription>
              We'll email a verification link to {{ account.email }}. Follow it
              to choose a new password.
            </p>
          </div>
          <div hlmCardContent class="grid gap-4">
            <p class="text-muted-foreground text-sm">
              The link expires in one hour. Changing your password signs you out
              on all devices.
            </p>
            @if (sent()) {
              <p role="status">
                Verification email sent. Check your inbox for the password reset
                link.
              </p>
            }
            @if (error()) {
              <p role="alert">{{ error() }}</p>
            }
          </div>
          <div hlmCardFooter>
            <button hlmBtn [disabled]="busy()" (click)="changePassword()">
              @if (busy()) {
                <hlm-spinner />
              }
              {{
                sent()
                  ? 'Send another verification email'
                  : 'Send password verification email'
              }}
            </button>
          </div>
        </section>
      }
    </div>
  `,
})
export class ProfilePage {
  readonly user = injectAuthUser();
  private readonly password = inject(AccountPassword);
  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal('');

  async changePassword() {
    if (this.busy()) return;
    this.busy.set(true);
    this.sent.set(false);
    this.error.set('');
    try {
      await this.password.selfReset();
      this.sent.set(true);
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse
          ? (error.error?.message ??
              'Could not send the verification email. Please try again.')
          : 'Could not send the verification email. Please try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
