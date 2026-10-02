import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { InstanceSetup } from '../auth/instance-setup';
import { SessionRecovery, safeRedirect } from '../auth/session-recovery';
import { injectLogout } from '../auth/auth-client';
import { AuthLayout } from '../layouts/auth.layout';

@Component({
  selector: 'app-unavailable',
  imports: [AuthLayout, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-auth-layout
    ><div class="grid gap-4">
      <h1 class="text-2xl font-bold">Cannot connect to senv</h1>
      <p role="alert">
        {{
          error() ||
            'Your session or instance could not be confirmed. Check your connection and try again.'
        }}
      </p>
      <button hlmBtn [disabled]="busy()" (click)="retry()">
        {{ busy() ? 'Retrying…' : 'Try again' }}</button
      ><button hlmBtn variant="outline" [disabled]="busy()" (click)="login()">
        Continue to login
      </button>
    </div></app-auth-layout
  >`,
})
export class UnavailablePage {
  readonly redirect = input<string>();
  readonly busy = signal(false);
  readonly error = signal('');
  private readonly setup = inject(InstanceSetup);
  private readonly recovery = inject(SessionRecovery);
  private readonly logout = injectLogout();
  private readonly router = inject(Router);
  async retry() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const status = await this.setup.status();
      await this.recovery.refresh(undefined, safeRedirect(this.redirect()));
      await this.router.navigateByUrl(
        status.needsSetup ? '/setup' : safeRedirect(this.redirect()),
        { replaceUrl: true },
      );
    } catch {
      this.error.set('senv is still unavailable. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
  async login() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.logout(safeRedirect(this.redirect()));
    } catch {
      this.error.set(
        'Could not confirm logout. Check your connection and try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
