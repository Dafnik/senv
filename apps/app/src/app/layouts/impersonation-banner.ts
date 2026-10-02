import { Component, inject } from '@angular/core';
import { signal } from '@angular/core';
import { SessionRecovery } from '../auth/session-recovery';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideUserCog } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { toast } from '@spartan-ng/brain/sonner';
import { unwrapAuthResult } from '../auth/auth-result';
import {
  injectAuthClient,
  injectAuthUser,
  injectIsImpersonating,
} from '../auth/auth-client';

@Component({
  selector: 'app-impersonation-banner',
  imports: [HlmButton, NgIcon],
  providers: [provideIcons({ lucideUserCog })],
  template: `
    @if (isImpersonating()) {
      <div class="h-12 px-2">
        <div
          class="flex h-full items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-100 px-2 dark:border-amber-800 dark:bg-amber-900"
        >
          <div
            class="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-100"
          >
            <ng-icon name="lucideUserCog" class="font-medium" />
            <span>
              You are impersonating
              <span class="font-medium">
                {{ user()?.name || user()?.email }}
              </span>
            </span>
          </div>
          <button
            hlmBtn
            size="sm"
            variant="outline"
            [disabled]="busy()"
            (click)="stopImpersonating()"
          >
            Stop impersonating
          </button>
        </div>
      </div>
    }
  `,
})
export class ImpersonationBanner {
  private readonly authClient = injectAuthClient();
  protected readonly busy = signal(false);
  private readonly recovery = inject(SessionRecovery);
  private readonly router = inject(Router);

  protected readonly isImpersonating = injectIsImpersonating();
  protected readonly user = injectAuthUser();

  async stopImpersonating() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const result = unwrapAuthResult(
        await this.authClient.admin.stopImpersonating(),
      );
      await this.recovery.refresh(
        (session) =>
          session?.user.id === result.user.id &&
          !session.session.impersonatedBy,
      );
      await this.router.navigateByUrl('/projects', { replaceUrl: true });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not stop impersonating.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
