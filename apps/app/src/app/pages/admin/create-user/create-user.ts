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
import { UsersData } from '../../../queries/users';
import { accountDetailsSchema } from '../../../tools/form-validation';

@Component({
  imports: [
    FormField,
    FormRoot,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
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
            A signup email lets this user choose their password and verifies
            their email address. You can then invite them to a project.
          </p>
        </div>
        <form
          hlmCardContent
          [formRoot]="userForm"
          (submit)="create($event)"
          class="grid gap-4 md:grid-cols-2"
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
          <div class="flex gap-2 md:col-span-2">
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
  private readonly users = inject(UsersData);
  private readonly model = signal({ name: '', email: '' });
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly created = output<void>();
  readonly userForm = form(this.model, accountDetailsSchema);

  close() {
    this.model.set({ name: '', email: '' });
    this.userForm().reset();
    this.open.set(false);
  }

  create(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    void submit(this.userForm, async () => {
      this.busy.set(true);
      try {
        const { name, email } = this.model();
        const result = await this.users.create(name.trim(), email.trim());
        await this.users.invalidate();
        this.created.emit();
        this.close();
        if ('signupEmailSent' in result && result.signupEmailSent === false) {
          toast.warning(
            'User account created, but the signup email could not be sent. Use Resend signup email in the user actions to try again.',
          );
        } else {
          toast.success('User account created. Signup email sent.');
        }
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
