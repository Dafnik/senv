import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query';
import { injectAuthClient } from './auth-client';
import { AuthState } from './auth-state';
import { environment } from '../../environments/environment';

export function safeRedirect(value: string | null | undefined) {
  return value?.startsWith('/') &&
    !value.startsWith('//') &&
    !/[\\\r\n]/.test(value) &&
    !/^\/(?:login|signup|setup|unavailable|forgot-password|reset-password)(?:[/?#]|$)/.test(
      value,
    )
    ? value
    : environment.defaultRedirect;
}

type SessionData = ReturnType<
  ReturnType<ReturnType<typeof injectAuthClient>['useSession']>
>['data'];
type SessionExpectation = (session: SessionData) => boolean;

@Injectable({ providedIn: 'root' })
export class SessionRecovery {
  private readonly auth = injectAuthClient();
  private readonly sessionQuery = this.auth.useSession();
  private readonly state = inject(AuthState);
  private readonly queries = inject(QueryClient);
  private readonly router = inject(Router);
  private expected: SessionExpectation | undefined;

  private begin() {
    this.state.blocked.set(true);
    this.queries.clear();
  }

  async refresh(
    expectation?: SessionExpectation,
    destination = environment.defaultRedirect,
  ) {
    this.begin();
    if (expectation) this.expected = expectation;
    try {
      await this.sessionQuery().refetch();
      const session = this.sessionQuery();
      if (
        session.error ||
        session.isPending ||
        (this.expected && !this.expected(session.data))
      )
        throw new Error(
          'Your session could not be confirmed. Retry, or continue to login.',
        );
      this.expected = undefined;
      this.state.blocked.set(false);
    } catch (error) {
      await this.router.navigate(['/unavailable'], {
        queryParams: { redirect: safeRedirect(destination) },
        replaceUrl: true,
      });
      throw error;
    }
  }
}
