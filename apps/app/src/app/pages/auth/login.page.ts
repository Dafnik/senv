import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  apply,
  form,
  FormField,
  FormRoot,
  submit,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { SessionRecovery, safeRedirect } from '../../auth/session-recovery';
import { unwrapAuthResult } from '../../auth/auth-result';
import {
  emailAddressSchema,
  passwordSchema,
} from '../../tools/form-validation';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { environment } from '../../../environments/environment';
import { injectAuthClient } from '../../auth/auth-client';
import { AuthLayout } from '../../layouts/auth.layout';
import { PasswordInput } from '../../ui/password-input';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthLayout,
    RouterLink,
    FormField,
    FormRoot,
    HlmFieldImports,
    HlmButtonImports,
    HlmInputImports,
    HlmSpinnerImports,
    PasswordInput,
  ],
  template: `
    <app-auth-layout>
      <form [formRoot]="form" (submit)="login($event)">
        <hlm-field-group>
          <div class="flex flex-col items-center gap-1 text-center">
            <h1 class="text-2xl font-bold">Login to your account</h1>
            <p class="text-muted-foreground text-sm text-balance">
              Enter your email below to login to your account
            </p>
          </div>
          <hlm-field>
            <label hlmFieldLabel for="email">Email</label>
            <input
              hlmInput
              type="email"
              id="email"
              placeholder="m@example.com"
              autocomplete="username"
              [formField]="form.email"
            />
            @if (form.email().touched() && form.email().invalid()) {
              @for (error of form.email().errors(); track error) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </hlm-field>
          <hlm-field>
            <label hlmFieldLabel for="password">Password</label>
            <spartan-password-input
              inputId="password"
              [formField]="form.password"
            />
            @if (form.password().touched() && form.password().invalid()) {
              @for (error of form.password().errors(); track error) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </hlm-field>
          <a routerLink="/forgot-password" class="text-sm underline"
            >Forgot password?</a
          >
          @if (errorMessage()) {
            <p role="alert" class="text-destructive text-sm">
              {{ errorMessage() }}
            </p>
          }
          <hlm-field>
            <button
              hlmBtn
              type="submit"
              [disabled]="form().invalid() || loading()"
            >
              @if (loading()) {
                <hlm-spinner />
              }
              Login
            </button>
            <p hlmFieldDescription class="text-center">
              Need an account? Ask your instance admin to create one.
            </p>
          </hlm-field>
        </hlm-field-group>
      </form>
    </app-auth-layout>
  `,
})
export class LoginPage {
  private readonly recovery = inject(SessionRecovery);
  private readonly router = inject(Router);
  readonly errorMessage = signal('');
  private authClient = injectAuthClient();

  readonly redirect = input<string, string | undefined>(
    environment.defaultRedirect,
    {
      transform: safeRedirect,
    },
  );

  private model = signal({
    email: '',
    password: '',
  });

  form = form(this.model, (p) => {
    apply(p.email, emailAddressSchema);
    apply(p.password, passwordSchema);
  });

  loading = signal(false);

  async login(event: Event) {
    event.preventDefault();

    if (this.loading()) return;
    await submit(this.form, async () => {
      this.loading.set(true);
      this.errorMessage.set('');
      try {
        const result = unwrapAuthResult(
          await this.authClient.signIn.email({
            email: this.model().email.trim(),
            password: this.model().password,
          }),
        );
        await this.recovery.refresh(
          (session) => session?.user.id === result.user.id,
          this.redirect(),
        );
        await this.router.navigateByUrl(this.redirect(), { replaceUrl: true });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Login failed. Please try again.';
        this.errorMessage.set(message);
        toast.error(message);
      } finally {
        this.loading.set(false);
      }
    });
  }
}
