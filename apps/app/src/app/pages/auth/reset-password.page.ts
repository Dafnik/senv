import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { AccountPassword } from '../../auth/account-password';
import { SessionRecovery } from '../../auth/session-recovery';
import { AuthLayout } from '../../layouts/auth.layout';
import { passwordConfirmationSchema } from '../../tools/form-validation';
import { PasswordInput } from '../../ui/password-input';

@Component({
  selector: 'app-reset-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthLayout,
    RouterLink,
    FormField,
    FormRoot,
    PasswordInput,
    HlmButtonImports,
    HlmFieldImports,
  ],
  template: `<app-auth-layout
    ><div class="grid gap-4">
      <h1 class="text-2xl font-bold">Reset your password</h1>
      @if (completed()) {
        <p role="status">
          Your password has been reset. Log in with your new password.
        </p>
        <a hlmBtn routerLink="/login">Continue to login</a>
      } @else if (!token) {
        <p role="alert">Open the reset link from your email.</p>
        <a hlmBtn routerLink="/forgot-password">Request a reset link</a>
      } @else {
        <form
          [formRoot]="passwordForm"
          (submit)="complete($event)"
          class="grid gap-4"
        >
          <div hlmField>
            <label hlmFieldLabel for="new-password">New password</label
            ><spartan-password-input
              inputId="new-password"
              autocomplete="new-password"
              [formField]="passwordForm.password"
            />
            @if (passwordForm.password().touched()) {
              @for (error of passwordForm.password().errors(); track error) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </div>
          <div hlmField>
            <label hlmFieldLabel for="confirm-password">Confirm password</label
            ><spartan-password-input
              inputId="confirm-password"
              autocomplete="new-password"
              [formField]="passwordForm.confirmPassword"
            />
            @if (passwordForm.confirmPassword().touched()) {
              @for (
                error of passwordForm.confirmPassword().errors();
                track error
              ) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </div>
          @if (error()) {
            <p role="alert">{{ error() }}</p>
            <a routerLink="/forgot-password" class="text-sm underline"
              >Request a new link</a
            >
          }
          <button
            hlmBtn
            type="submit"
            [disabled]="busy() || passwordForm().invalid()"
          >
            {{ busy() ? 'Resetting…' : 'Reset password' }}
          </button>
        </form>
      }
    </div></app-auth-layout
  >`,
})
export class ResetPasswordPage {
  readonly token =
    inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';
  private readonly password = inject(AccountPassword);
  private readonly recovery = inject(SessionRecovery);
  private readonly model = signal({ password: '', confirmPassword: '' });
  readonly passwordForm = form(this.model, passwordConfirmationSchema);
  readonly busy = signal(false);
  readonly completed = signal(false);
  readonly error = signal('');
  complete(event: Event) {
    event.preventDefault();
    if (this.busy() || this.completed()) return;
    void submit(this.passwordForm, async () => {
      this.busy.set(true);
      this.error.set('');
      try {
        await this.password.complete(this.token, this.model().password);
        this.completed.set(true);
        await this.recovery.refresh(undefined, '/projects');
      } catch (error) {
        this.error.set(
          this.completed()
            ? 'Password reset completed. Continue to login.'
            : error instanceof HttpErrorResponse
              ? (error.error?.message ??
                'Could not reset your password. Please try again.')
              : 'Could not reset your password. Please try again.',
        );
      } finally {
        this.busy.set(false);
      }
    });
  }
}
