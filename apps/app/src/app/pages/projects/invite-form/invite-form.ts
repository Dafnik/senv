import { TitleCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
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
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { ProjectsData } from '../../../queries/projects';
import { emailAddressSchema } from '../../../tools/form-validation';

@Component({
  selector: 'app-invite-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TitleCasePipe,
    FormField,
    FormRoot,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    HlmToggleGroupImports,
  ],
  template: `
    @if (!open()) {
      <button hlmBtn (click)="open.set(true)">Invite user</button>
    } @else {
      <section hlmCard>
        <div hlmCardHeader>
          <h2 hlmCardTitle>Invite a project member</h2>
          <p hlmCardDescription>
            Choose a role and send an invitation to their email address. They
            need an account and a verified email to accept the invitation.
          </p>
        </div>
        <form
          hlmCardContent
          [formRoot]="inviteForm"
          class="grid gap-4 md:grid-cols-2"
          (submit)="invite($event)"
        >
          <div hlmField>
            <label hlmFieldLabel for="invite-email">Email address</label>
            <input
              hlmInput
              id="invite-email"
              type="email"
              autocomplete="off"
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
                <button hlmToggleGroupItem type="button" [value]="role">
                  {{ role | titlecase }}
                </button>
              }
            </hlm-toggle-group>
          </fieldset>
          <div class="flex gap-2 md:col-span-2">
            <button
              hlmBtn
              type="submit"
              [disabled]="busy() || inviteForm().invalid()"
            >
              @if (busy()) {
                <hlm-spinner />
              }
              Send invitation
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
export class InviteForm {
  readonly projectId = input.required<string>();
  readonly sent = output<void>();
  private readonly projects = inject(ProjectsData);
  readonly roles = projectRoleNames;
  readonly open = signal(false);
  readonly busy = signal(false);
  protected readonly model = signal<{ email: string; role: ProjectRole }>({
    email: '',
    role: 'viewer',
  });
  readonly inviteForm = form(this.model, (p) =>
    apply(p.email, emailAddressSchema),
  );

  close() {
    this.model.set({ email: '', role: 'viewer' });
    this.inviteForm().reset();
    this.open.set(false);
  }

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
        await this.projects.invite(this.projectId(), email.trim(), role);
        this.sent.emit();
        this.close();
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
