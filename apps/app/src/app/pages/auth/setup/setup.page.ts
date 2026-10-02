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
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { injectAuthClient } from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';
import { accountSchema } from '../../../tools/form-validation';
import { InstanceSetup } from '../../../auth/instance-setup';
import { AuthLayout } from '../../../layouts/auth.layout';
import { PasswordInput } from '../../../ui/password-input';

@Component({
  imports: [
    AuthLayout,
    FormField,
    FormRoot,
    HlmButtonImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    PasswordInput,
  ],
  selector: 'app-setup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout>
      <form [formRoot]="adminForm" (submit)="create($event)">
        <div hlmFieldGroup>
          <header class="grid gap-2">
            <p
              class="text-muted-foreground text-xs font-medium tracking-widest uppercase"
            >
              Instance setup
            </p>
            <h1 class="text-3xl font-semibold tracking-tight">
              Make this instance yours.
            </h1>
            <p class="text-muted-foreground text-sm">
              Create the first admin account to manage users and projects.
            </p>
          </header>
          <div hlmField>
            <label hlmFieldLabel for="setup-name">Full name</label>
            <input
              hlmInput
              id="setup-name"
              autocomplete="name"
              [formField]="adminForm.name"
            />
            @if (adminForm.name().touched()) {
              @for (error of adminForm.name().errors(); track error) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </div>
          <div hlmField>
            <label hlmFieldLabel for="setup-email">Email address</label>
            <input
              hlmInput
              id="setup-email"
              type="email"
              autocomplete="username"
              [formField]="adminForm.email"
            />
            @if (adminForm.email().touched()) {
              @for (error of adminForm.email().errors(); track error) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </div>
          <div hlmField>
            <label hlmFieldLabel for="setup-password">Password</label>
            <spartan-password-input
              inputId="setup-password"
              autocomplete="new-password"
              [formField]="adminForm.password"
            />
            @if (adminForm.password().touched()) {
              @for (error of adminForm.password().errors(); track error) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </div>
          <div hlmField>
            <label hlmFieldLabel for="setup-confirm-password"
              >Confirm password</label
            >
            <spartan-password-input
              inputId="setup-confirm-password"
              autocomplete="new-password"
              [formField]="adminForm.confirmPassword"
            />
            @if (adminForm.confirmPassword().touched()) {
              @for (
                error of adminForm.confirmPassword().errors();
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
          @if (created()) {
            <a hlmBtn href="/login">Continue to login</a>
          } @else {
            <button
              hlmBtn
              type="submit"
              [disabled]="busy() || adminForm().invalid()"
            >
              @if (busy()) {
                <hlm-spinner />
              }
              Create admin account
            </button>
          }
          <p class="text-muted-foreground text-xs">
            You can sign in immediately. Email verification is not required to
            set up this instance.
          </p>
        </div>
      </form>
    </app-auth-layout>
  `,
})
export class SetupPage {
  private readonly setup = inject(InstanceSetup);
  private readonly auth = injectAuthClient();
  private readonly router = inject(Router);
  private readonly model = signal({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  readonly busy = signal(false);
  readonly created = signal(false);
  readonly errorMessage = signal('');
  readonly adminForm = form(this.model, (p) => {
    apply(p, accountSchema);
    required(p.confirmPassword, { message: 'Confirm your password.' });
    validate(p.confirmPassword, ({ value, valueOf }) =>
      value() === valueOf(p.password)
        ? null
        : { kind: 'passwordMismatch', message: 'Passwords do not match.' },
    );
  });

  create(event: Event) {
    event.preventDefault();
    if (this.busy() || this.created()) return;
    void submit(this.adminForm, async () => {
      this.busy.set(true);
      this.errorMessage.set('');
      try {
        const { name, email, password } = this.model();
        await this.setup.createAdmin({
          name: name.trim(),
          email: email.trim(),
          password,
        });
        this.created.set(true);
        unwrapAuthResult(
          await this.auth.signIn.email({ email: email.trim(), password }),
        );
        await this.auth.useSession()().refetch();
        toast.success('Your instance is ready.');
        await this.router.navigateByUrl('/admin', { replaceUrl: true });
      } catch (error) {
        this.errorMessage.set(
          error instanceof HttpErrorResponse
            ? error.error?.message || 'Could not set up this instance.'
            : error instanceof Error
              ? error.message
              : 'Could not set up this instance.',
        );
        if (
          !this.created() &&
          error instanceof HttpErrorResponse &&
          error.status === 403
        ) {
          await this.router.navigateByUrl('/login', { replaceUrl: true });
        }
      } finally {
        this.busy.set(false);
      }
    });
  }
}
