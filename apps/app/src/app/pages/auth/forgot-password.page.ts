import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
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
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { AccountPassword } from '../../auth/account-password';
import { AuthLayout } from '../../layouts/auth.layout';
import { emailAddressSchema } from '../../tools/form-validation';

@Component({
  selector: 'app-forgot-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthLayout,
    RouterLink,
    FormField,
    FormRoot,
    HlmButtonImports,
    HlmFieldImports,
    HlmInputImports,
  ],
  template: `<app-auth-layout
    ><form [formRoot]="resetForm" (submit)="request($event)" class="grid gap-4">
      <h1 class="text-2xl font-bold">Forgot your password?</h1>
      <p class="text-muted-foreground text-sm">
        Enter your email address to request a reset link.
      </p>
      <div hlmField>
        <label hlmFieldLabel for="reset-email">Email address</label
        ><input
          hlmInput
          id="reset-email"
          type="email"
          autocomplete="email"
          [formField]="resetForm.email"
        />
        @if (resetForm.email().touched()) {
          @for (error of resetForm.email().errors(); track error) {
            <hlm-field-error>{{ error.message }}</hlm-field-error>
          }
        }
      </div>
      @if (sent()) {
        <p role="status">
          If this account can reset its password, check your inbox for a reset
          link. If you are setting up a new account, use your signup email.
        </p>
      }
      @if (error()) {
        <p role="alert">{{ error() }}</p>
      }
      <button hlmBtn type="submit" [disabled]="busy() || resetForm().invalid()">
        {{ busy() ? 'Requesting…' : 'Send reset link' }}</button
      ><a routerLink="/login" class="text-sm underline">Back to login</a>
    </form></app-auth-layout
  >`,
})
export class ForgotPasswordPage {
  private readonly password = inject(AccountPassword);
  private readonly model = signal({ email: '' });
  readonly resetForm = form(this.model, (p) =>
    apply(p.email, emailAddressSchema),
  );
  readonly busy = signal(false);
  readonly sent = signal(false);
  readonly error = signal('');
  request(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    void submit(this.resetForm, async () => {
      this.busy.set(true);
      this.error.set('');
      this.sent.set(false);
      try {
        await this.password.request(this.model().email.trim());
        this.sent.set(true);
      } catch (error) {
        this.error.set(
          error instanceof HttpErrorResponse
            ? (error.error?.message ??
                'Could not request a reset email. Please try again.')
            : 'Could not request a reset email. Please try again.',
        );
      } finally {
        this.busy.set(false);
      }
    });
  }
}
