import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import {
  apply,
  form,
  FormField,
  FormRoot,
  submit,
} from '@angular/forms/signals';
import {
  isProjectRole,
  projectRoleNames,
  type ProjectRole,
} from '@senv/api/shared/project-permissions';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { injectAuthClient } from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';
import { emailAddressSchema } from '../../../tools/form-validation';

@Component({
  selector: 'app-invite-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    FormRoot,
    HlmButtonImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    HlmToggleGroupImports,
  ],
  template: `
    <form
      [formRoot]="inviteForm"
      class="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-start"
      (submit)="invite($event)"
    >
      <div hlmField>
        <label hlmFieldLabel for="invite-email">Email address</label>
        <input
          hlmInput
          id="invite-email"
          type="email"
          autocomplete="email"
          placeholder="teammate@example.com"
          [formField]="inviteForm.email"
        />
        @if (inviteForm.email().touched()) {
          @for (error of inviteForm.email().errors(); track error) {
            <hlm-field-error>{{ error.message }}</hlm-field-error>
          }
        }
      </div>
      <fieldset hlmFieldSet>
        <legend hlmFieldLegend id="role-label">Project role</legend>
        <hlm-toggle-group
          type="single"
          variant="outline"
          [nullable]="false"
          [value]="model().role"
          (valueChange)="selectRole($event)"
          aria-labelledby="role-label"
        >
          @for (role of roles; track role) {
            <button
              hlmToggleGroupItem
              type="button"
              [value]="role"
              class="capitalize"
            >
              {{ role }}
            </button>
          }
        </hlm-toggle-group>
      </fieldset>
      <button
        hlmBtn
        type="submit"
        class="md:mt-6"
        [disabled]="busy() || inviteForm().invalid()"
      >
        @if (busy()) {
          <hlm-spinner />
        }
        Send invitation
      </button>
    </form>
  `,
})
export class InviteForm {
  readonly projectId = input.required<string>();
  readonly sent = output<void>();
  private readonly auth = injectAuthClient();
  readonly roles = projectRoleNames;
  readonly busy = signal(false);
  protected readonly model = signal<{ email: string; role: ProjectRole }>({
    email: '',
    role: 'viewer',
  });
  readonly inviteForm = form(this.model, (p) =>
    apply(p.email, emailAddressSchema),
  );

  selectRole(value: unknown) {
    if (isProjectRole(value))
      this.model.update((model) => ({ ...model, role: value }));
  }

  invite(event: Event) {
    event.preventDefault();
    if (this.busy()) return;
    void submit(this.inviteForm, async () => {
      this.busy.set(true);
      try {
        const { email, role } = this.model();
        unwrapAuthResult(
          await this.auth.organization.inviteMember({
            organizationId: this.projectId(),
            email: email.trim(),
            role,
          }),
        );
        this.model.update((model) => ({ ...model, email: '' }));
        this.inviteForm().reset();
        this.sent.emit();
        toast.success('Invitation sent.');
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Could not send the invitation.',
        );
      } finally {
        this.busy.set(false);
      }
    });
  }
}
