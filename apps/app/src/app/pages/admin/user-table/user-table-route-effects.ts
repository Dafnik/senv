import { effect } from '@angular/core';
import type { Router } from '@angular/router';
import {
  isFunction,
  type PaginationState,
  type SortingState,
} from '@tanstack/angular-table';
import { serializeSort } from '../../../tools/table/sort';
import { lastPageIndex } from '../../../tools/table/pagination';

type UserQueryState = {
  isSuccess: () => boolean;
  isFetching: () => boolean;
  data: () => { total: number } | undefined;
};

export function synchronizeUserTableRoute(
  query: UserQueryState,
  pagination: () => PaginationState,
  router: Router,
  debouncedSearch: { value: () => string | undefined },
  routeSearch: () => string | undefined,
) {
  effect(() => {
    if (!query.isSuccess() || query.isFetching()) return;
    const lastPage = lastPageIndex(
      query.data()?.total ?? 0,
      pagination().pageSize,
    );
    if (pagination().pageIndex > lastPage) {
      void router.navigate([], {
        queryParams: { page: lastPage + 1 },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  });

  effect(() => {
    const value = debouncedSearch.value() ?? '';
    const search = value.trim();
    if (search === (routeSearch() ?? '').trim()) return;

    void router.navigate([], {
      queryParams: { q: search || undefined, page: 1 },
      queryParamsHandling: 'merge',
    });
  });
}

export function navigateToUserSort(
  router: Router,
  updater: SortingState | ((current: SortingState) => SortingState),
  current: SortingState,
) {
  const sorting = isFunction(updater) ? updater(current) : updater;
  void router.navigate([], {
    queryParams: { sort: serializeSort(sorting) },
    queryParamsHandling: 'merge',
  });
}

export function navigateToUserPage(
  router: Router,
  updater: PaginationState | ((current: PaginationState) => PaginationState),
  current: PaginationState,
) {
  const pagination = isFunction(updater) ? updater(current) : updater;
  void router.navigate([], {
    queryParams: {
      page: pagination.pageIndex + 1,
      size: pagination.pageSize,
    },
    queryParamsHandling: 'merge',
  });
}
