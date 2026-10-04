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
import { Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { SessionRecovery } from '../../../auth/session-recovery';
import { injectAuthClient } from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';
import {
  accountDetailsSchema,
  passwordConfirmationSchema,
} from '../../../tools/form-validation';
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
  templateUrl: './setup.page.html',
})
export class SetupPage {
  private readonly setup = inject(InstanceSetup);
  private readonly auth = injectAuthClient();
  private readonly recovery = inject(SessionRecovery);
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
    apply(p, accountDetailsSchema);
    apply(p, passwordConfirmationSchema);
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
        await this.recovery.refresh(
          (session) => session?.user.email === email.trim().toLowerCase(),
          '/projects',
        );
        toast.success('Your instance is ready.');
        await this.router.navigateByUrl('/projects', { replaceUrl: true });
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
