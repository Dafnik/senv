import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QueryClient } from '@tanstack/angular-query';
import { distinctUntilChanged, filter, map, skip } from 'rxjs';
import { injectAuthSession } from './auth-client';

export function watchSessionQueryCache() {
  const session = injectAuthSession();
  const queryClient = inject(QueryClient);

  session
    .pipe(
      filter((state) => !state.isPending),
      map((state) => state.data?.session.id ?? null),
      distinctUntilChanged(),
      skip(1),
      takeUntilDestroyed(),
    )
    .subscribe(() => queryClient.clear());
}
