import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  apply,
  form,
  FormField,
  FormRoot,
  submit,
} from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { environment } from '../../../../environments/environment';
import { AccountSignup } from '../../../auth/account-signup';
import { SessionRecovery } from '../../../auth/session-recovery';
import { AuthLayout } from '../../../layouts/auth.layout';
import { passwordConfirmationSchema } from '../../../tools/form-validation';
import { PasswordInput } from '../../../ui/password-input';

@Component({
  selector: 'app-signup',
  imports: [
    AuthLayout,
    FormField,
    FormRoot,
    RouterLink,
    HlmButtonImports,
    HlmFieldImports,
    HlmSpinnerImports,
    PasswordInput,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout>
      @if (loading()) {
        <div role="status" class="flex items-center gap-2">
          <hlm-spinner />Checking your signup link
        </div>
      } @else if (details()) {
        <form [formRoot]="passwordForm" (submit)="complete($event)">
          <div hlmFieldGroup>
            <header class="grid gap-2">
              <h1 class="text-2xl font-bold">Set up your account</h1>
              <p class="text-muted-foreground text-sm">
                Hello {{ details()?.name }}. Choose a password for
                {{ details()?.email }}.
              </p>
              <p class="text-muted-foreground text-sm">
                Completing signup verifies your email and logs you in.
              </p>
            </header>
            <div hlmField>
              <label hlmFieldLabel for="signup-password">Password</label>
              <spartan-password-input
                inputId="signup-password"
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
              <label hlmFieldLabel for="signup-confirm-password"
                >Confirm password</label
              >
              <spartan-password-input
                inputId="signup-confirm-password"
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
            @if (errorMessage()) {
              <p role="alert" class="text-destructive text-sm">
                {{ errorMessage() }}
              </p>
            }
            @if (completed()) {
              <a hlmBtn routerLink="/login">Continue to login</a>
            } @else {
              <button
                hlmBtn
                type="submit"
                [disabled]="busy() || passwordForm().invalid()"
              >
                @if (busy()) {
                  <hlm-spinner />
                }
                Finish signup
              </button>
            }
          </div>
        </form>
      } @else {
        <div hlmFieldGroup>
          <h1 class="text-2xl font-bold">Signup link unavailable</h1>
          <p role="alert" class="text-muted-foreground text-sm">
            {{ errorMessage() }}
          </p>
          <a hlmBtn variant="outline" routerLink="/login">Go to login</a>
        </div>
      }
    </app-auth-layout>
  `,
})
export class SignupPage implements OnInit {
  private readonly signup = inject(AccountSignup);
  private readonly recovery = inject(SessionRecovery);
  private readonly router = inject(Router);
  private readonly token =
    inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';
  private readonly model = signal({ password: '', confirmPassword: '' });
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly completed = signal(false);
  readonly details = signal<{ name: string; email: string } | null>(null);
  readonly errorMessage = signal('');
  readonly passwordForm = form(this.model, (p) => {
    apply(p, passwordConfirmationSchema);
  });

  async ngOnInit() {
    try {
      if (!this.token)
        throw new Error(
          'Open the signup link from your email. Ask your admin for a new email if the link has expired.',
        );
      this.details.set(await this.signup.details(this.token));
    } catch (error) {
      this.errorMessage.set(
        this.message(
          error,
          'Could not open this signup link. Ask your admin to send a new signup email.',
        ),
      );
    } finally {
      this.loading.set(false);
    }
  }

  complete(event: Event) {
    event.preventDefault();
    if (this.busy() || this.completed()) return;
    void submit(this.passwordForm, async () => {
      this.busy.set(true);
      this.errorMessage.set('');
      try {
        await this.signup.complete({
          token: this.token,
          password: this.model().password,
        });
        this.completed.set(true);
        await this.recovery.refresh(
          (session) => session?.user.email === this.details()?.email,
          '/projects',
        );
        await this.router.navigateByUrl(environment.defaultRedirect, {
          replaceUrl: true,
        });
      } catch (error) {
        this.errorMessage.set(
          this.completed()
            ? 'Your account is ready. Continue to login with your new password.'
            : this.message(
                error,
                'Could not complete signup. Please try again.',
              ),
        );
      } finally {
        this.busy.set(false);
      }
    });
  }

  private message(error: unknown, fallback: string) {
    return error instanceof HttpErrorResponse
      ? (error.error?.message ?? fallback)
      : error instanceof Error
        ? error.message
        : fallback;
  }
}
