import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { form, FormField, required } from '@angular/forms/signals';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { CliAuthorization } from '../../../auth/cli-authorization';
import {
  injectAuthUser,
  injectIsImpersonating,
} from '../../../auth/auth-client';
import { injectTrpc } from '../../../trpc/trpc.service';

@Component({
  imports: [
    FormField,
    RouterLink,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
  ],
  selector: 'app-cli-authorize',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto grid w-full max-w-xl gap-6 p-4 md:p-8">
      <section hlmCard>
        <div hlmCardHeader>
          <h1 hlmCardTitle>Authorize senv CLI</h1>
          <p hlmCardDescription>
            Approve a login you started in your terminal.
          </p>
        </div>
        <div hlmCardContent class="grid gap-4">
          @if (impersonating()) {
            <p role="alert">Stop impersonating before authorizing a CLI.</p>
          } @else if (completed()) {
            <p role="status">
              {{ completed() }} You can return to your terminal.
            </p>
            <a hlmBtn variant="outline" routerLink="/profile"
              >Manage sessions</a
            >
          } @else {
            <p>
              Signed in as {{ user()?.email }}. The CLI will use your current
              account and project permissions.
            </p>
            <form
              (submit)="$event.preventDefault(); review()"
              class="grid gap-4"
            >
              <div hlmField>
                <label hlmFieldLabel for="cli-code"
                  >Code from your terminal</label
                ><input
                  hlmInput
                  id="cli-code"
                  autocomplete="off"
                  [formField]="codeForm.userCode"
                />
                <p hlmFieldDescription>
                  Compare this code with the terminal that requested access.
                </p>
              </div>
              <button
                hlmBtn
                type="submit"
                [disabled]="busy() || codeForm().invalid()"
              >
                Review request
              </button>
            </form>
            @if (request(); as detail) {
              <dl class="grid gap-3">
                <div>
                  <dt>Device</dt>
                  <dd>{{ detail.label }}</dd>
                </div>
                <div>
                  <dt>CLI version</dt>
                  <dd>{{ detail.version }}</dd>
                </div>
                <div>
                  <dt>Instance</dt>
                  <dd class="break-all">{{ detail.appUrl }}</dd>
                </div>
              </dl>
              <p class="text-muted-foreground text-sm">
                Only approve if you requested this login. Device names come from
                the requesting CLI.
              </p>
              <div class="flex gap-3">
                <button hlmBtn [disabled]="busy()" (click)="decide(true)">
                  Approve CLI login</button
                ><button
                  hlmBtn
                  variant="outline"
                  [disabled]="busy()"
                  (click)="decide(false)"
                >
                  Deny
                </button>
              </div>
            }
          }
          @if (busy()) {
            <hlm-spinner aria-label="Processing authorization" />
          }
          @if (error()) {
            <p role="alert">{{ error() }}</p>
          }
        </div>
      </section>
    </div>
  `,
})
export class CliAuthorize {
  private readonly route = inject(ActivatedRoute);
  private readonly authorization = inject(CliAuthorization);
  private readonly trpc = injectTrpc();
  readonly user = injectAuthUser();
  readonly impersonating = injectIsImpersonating();
  readonly model = signal({
    userCode: this.route.snapshot.queryParamMap.get('user_code') ?? '',
  });
  readonly codeForm = form(this.model, (path) => required(path.userCode));
  readonly request = signal<{
    label: string;
    version: string;
    appUrl: string;
  } | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly completed = signal('');
  private reviewedCode = '';
  async review() {
    if (this.busy() || this.impersonating() || this.codeForm().invalid())
      return;
    this.busy.set(true);
    this.error.set('');
    this.request.set(null);
    const userCode = this.model()
      .userCode.trim()
      .toUpperCase()
      .replaceAll('-', '');
    try {
      const detail = await this.trpc.client.cli.device.query({ userCode });
      if (detail.status !== 'pending')
        throw new Error(
          'This request has already been processed. Start a new CLI login.',
        );
      await this.authorization.verify(userCode);
      this.reviewedCode = userCode;
      this.request.set(detail);
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Could not verify the authorization code.',
      );
    } finally {
      this.busy.set(false);
    }
  }
  async decide(approve: boolean) {
    if (this.busy() || !this.request() || this.impersonating()) return;
    if (
      this.model().userCode.trim().toUpperCase().replaceAll('-', '') !==
      this.reviewedCode
    ) {
      this.request.set(null);
      this.error.set('The code changed. Review it again.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.authorization.decide(this.reviewedCode, approve);
      this.request.set(null);
      this.completed.set(approve ? 'CLI login approved.' : 'CLI login denied.');
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Could not complete authorization.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
