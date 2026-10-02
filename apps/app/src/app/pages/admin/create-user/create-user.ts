import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { QueryClient } from '@tanstack/angular-query';
import { injectAuthClient } from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';
import { accountSchema } from '../../../tools/form-validation';
import { PasswordInput } from '../../../ui/password-input';

@Component({
  imports: [
    FormField,
    FormRoot,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    PasswordInput,
  ],
  selector: 'app-create-user',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!open()) {
      <button hlmBtn (click)="open.set(true)">Add user</button>
    } @else {
      <section hlmCard>
        <div hlmCardHeader>
          <h2 hlmCardTitle>Create a user account</h2>
          <p hlmCardDescription>
            Share the login details with this user, then invite them to a
            project. They must verify their email to accept invitations.
          </p>
        </div>
        <form
          hlmCardContent
          [formRoot]="userForm"
          (submit)="create($event)"
          class="grid gap-4 md:grid-cols-3"
        >
          <div hlmField>
            <label hlmFieldLabel for="new-user-name">Full name</label>
            <input
              hlmInput
              id="new-user-name"
              autocomplete="off"
              [formField]="userForm.name"
            />
            @if (userForm.name().touched()) {
              @for (error of userForm.name().errors(); track error) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </div>
          <div hlmField>
            <label hlmFieldLabel for="new-user-email">Email address</label>
            <input
              hlmInput
              id="new-user-email"
              type="email"
              autocomplete="off"
              [formField]="userForm.email"
            />
            @if (userForm.email().touched()) {
              @for (error of userForm.email().errors(); track error) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </div>
          <div hlmField>
            <label hlmFieldLabel for="new-user-password">Password</label>
            <spartan-password-input
              inputId="new-user-password"
              autocomplete="new-password"
              [formField]="userForm.password"
            />
            @if (userForm.password().touched()) {
              @for (error of userForm.password().errors(); track error) {
                <hlm-field-error>{{ error.message }}</hlm-field-error>
              }
            }
          </div>
          <div class="flex gap-2 md:col-span-3">
            <button
              hlmBtn
              type="submit"
              [disabled]="busy() || userForm().invalid()"
            >
              @if (busy()) {
                <hlm-spinner />
              }
              Create user
            </button>
            <button
              hlmBtn
              type="button"
              variant="outline"
              [disabled]="busy()"
              (click)="close()"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    }
  `,
})
export class CreateUser {
  private readonly auth = injectAuthClient();
  private readonly queryClient = inject(QueryClient);
  private readonly model = signal({ name: '', email: '', password: '' });
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly created = output<void>();
  readonly userForm = form(this.model, accountSchema);

  close() {
    this.model.set({ name: '', email: '', password: '' });
    this.userForm().reset();
    this.open.set(false);
  }

  create(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    void submit(this.userForm, async () => {
      this.busy.set(true);
      try {
        const { name, email, password } = this.model();
        unwrapAuthResult(
          await this.auth.admin.createUser({
            name: name.trim(),
            email: email.trim(),
            password,
            role: 'user',
          }),
        );
        await this.queryClient.invalidateQueries({ queryKey: ['users'] });
        this.created.emit();
        this.close();
        toast.success('User account created.');
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not create the user account.',
        );
      } finally {
        this.busy.set(false);
      }
    });
  }
}
