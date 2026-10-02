import { computed, inject, InjectionToken } from '@angular/core';
import { QueryClient } from '@tanstack/angular-query';
import { AuthState } from './auth-state';
import { unwrapAuthResult } from './auth-result';
import { Router } from '@angular/router';
import {
  projectAccess,
  projectRoles,
} from '@senv/api/shared/project-permissions';
import { adminClient, organizationClient } from 'better-auth/client/plugins';
import { environment } from '../../environments/environment';
import { createAuthClient } from './better-auth-adapter';

const injectDefaultAuthClient = createAuthClient({
  baseURL: environment.apiUrl,
  plugins: [
    adminClient(),
    organizationClient({ ac: projectAccess, roles: projectRoles }),
  ],
});

export const AUTH_CLIENT = new InjectionToken<
  ReturnType<typeof injectDefaultAuthClient>
>('AUTH_CLIENT', {
  providedIn: 'root',
  factory: injectDefaultAuthClient,
});

export const injectAuthClient = () => inject(AUTH_CLIENT);

export const injectAuthSession = () => {
  const auth = injectAuthClient();
  return auth.useSession();
};

export const injectAuthSessionId = () => {
  const session = injectAuthSession();
  const state = inject(AuthState);
  return computed(() =>
    state.blocked() ? null : (session().data?.session.id ?? null),
  );
};

export const injectAuthUser = () => {
  const session = injectAuthSession();
  const state = inject(AuthState);
  return computed(() =>
    state.blocked() ? null : session().data?.user || null,
  );
};

export const injectIsAdmin = () => {
  const user = injectAuthUser();
  return computed(() => user()?.role === 'admin');
};

export const injectIsImpersonating = () => {
  const session = injectAuthSession();
  const state = inject(AuthState);
  return computed(
    () => !state.blocked() && !!session().data?.session.impersonatedBy,
  );
};

export const injectLogout = () => {
  const auth = injectAuthClient();
  const router = inject(Router);
  const queries = inject(QueryClient);
  const state = inject(AuthState);
  return async (redirect?: string) => {
    state.blocked.set(true);
    queries.clear();
    try {
      unwrapAuthResult(await auth.signOut());
      await auth.useSession()().refetch();
      const session = auth.useSession()();
      if (session.error || session.data)
        throw new Error('Could not confirm logout. Please retry.');
      state.blocked.set(false);
      await router.navigate(['/login'], {
        queryParams: redirect ? { redirect } : {},
        replaceUrl: true,
      });
    } catch (error) {
      await router.navigate(['/unavailable'], {
        queryParams: redirect ? { redirect } : {},
        replaceUrl: true,
      });
      throw error;
    }
  };
};
