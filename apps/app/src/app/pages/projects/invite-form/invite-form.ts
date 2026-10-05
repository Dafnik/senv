import { TitleCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  apply,
  disabled,
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
import { injectAuthSessionId } from '../../../auth/auth-client';
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
  templateUrl: './invite-form.html',
})
export class InviteForm {
  readonly projectId = input.required<string>();
  readonly sent = output<{ projectId: string; sessionId: string | null }>();
  private readonly projects = inject(ProjectsData);
  private readonly sessionId = injectAuthSessionId();
  private readonly scopeIdentity = computed(() => ({
    projectId: this.projectId(),
    sessionId: this.sessionId(),
  }));
  readonly roles = projectRoleNames;
  readonly open = signal(false);
  readonly busy = linkedSignal(() => {
    this.projectId();
    this.sessionId();
    return false;
  });
  private readonly operation = signal(0);
  protected readonly model = signal<{ email: string; role: ProjectRole }>({
    email: '',
    role: 'viewer',
  });
  readonly inviteForm = form(this.model, (p) => {
    apply(p.email, emailAddressSchema);
    disabled(p, () => this.busy());
  });

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
      const projectId = this.projectId();
      const sessionId = this.sessionId();
      const scopeIdentity = this.scopeIdentity();
      const operation = this.operation() + 1;
      this.operation.set(operation);
      const ownsView = () =>
        operation === this.operation() &&
        scopeIdentity === this.scopeIdentity() &&
        projectId === this.projectId() &&
        sessionId === this.sessionId();
      this.busy.set(true);
      try {
        const { email, role } = this.model();
        await this.projects.invite(projectId, email.trim(), role);
        await this.projects.invalidateInvitations(sessionId, projectId);
        if (!ownsView()) return;
        this.sent.emit({ projectId, sessionId });
        this.close();
        toast.success('Invitation sent.');
      } catch (error) {
        if (ownsView())
          toast.error(
            error instanceof Error
              ? error.message
              : 'Could not send the invitation.',
          );
      } finally {
        if (ownsView()) this.busy.set(false);
      }
    });
  }
}
