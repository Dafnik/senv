import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { AuthState } from './auth-state';
import { safeRedirect } from './session-recovery';
import { injectAuthClient } from './auth-client';

export const authGuard = (...roles: string[]): CanActivateFn => {
  return (_, state) => {
    const auth = injectAuthClient();
    const router = inject(Router);
    const authState = inject(AuthState);

    return auth.useSession().pipe(
      filter((s) => !s.isPending),
      map((s) => {
        if (s.error || authState.blocked())
          return router.createUrlTree(['/unavailable'], {
            queryParams: { redirect: state.url },
          });
        if (!s.data?.user) {
          return router.createUrlTree(['/login'], {
            queryParams: { redirect: state.url ?? '/' },
          });
        }

        // requires admin plugin
        if (roles.length > 0 && !roles.includes(s.data.user.role ?? '')) {
          return router.parseUrl('/forbidden');
        }

        return true;
      }),
    );
  };
};

export const redirectLoggedInGuard: CanActivateFn = (route) => {
  const auth = injectAuthClient();
  const router = inject(Router);

  return auth.useSession().pipe(
    filter((s) => !s.isPending),
    map((s) => {
      if (s.error)
        return router.createUrlTree(['/unavailable'], {
          queryParams: {
            redirect: safeRedirect(route.queryParamMap.get('redirect')),
          },
        });
      if (!s.data?.user) return true;
      const redirect = route.queryParamMap.get('redirect');
      return router.parseUrl(safeRedirect(redirect));
    }),
  );
};
