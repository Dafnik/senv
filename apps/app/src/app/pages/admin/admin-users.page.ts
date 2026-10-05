import { Component, computed, effect, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { AdminStats } from './admin-stats';
import { CreateUser } from './create-user/create-user';
import { UserTable } from './user-table/user-table';
import {
  canonicalUserPageParam,
  canonicalUserPageSizeParam,
  normalizeUserPage,
  normalizeUserPageSize,
} from './user-table/user-pagination';

@Component({
  selector: 'app-admin-users',
  imports: [AdminStats, CreateUser, UserTable],
  template: `
    <div class="flex flex-col gap-4 px-4 pt-4">
      <app-admin-stats />
      <app-create-user />
      <app-user-table
        [q]="q()"
        [sort]="sort()"
        [page]="page().toString()"
        [size]="size().toString()"
      />
    </div>
  `,
})
export class AdminUsersPage {
  private readonly router = inject(Router);
  readonly sort = input<string>('');
  readonly q = input<string>('');
  readonly rawPage = input<string>(undefined, { alias: 'page' });
  readonly rawSize = input<string>(undefined, { alias: 'size' });
  readonly page = computed(() => normalizeUserPage(this.rawPage()));
  readonly size = computed(() => normalizeUserPageSize(this.rawSize()));

  constructor() {
    effect(() => {
      const page = canonicalUserPageParam(this.rawPage());
      const size = canonicalUserPageSizeParam(this.rawSize());
      if (page === undefined && size === undefined) return;
      void this.router.navigate([], {
        queryParams: {
          ...(page === undefined ? {} : { page: normalizeUserPage(page) }),
          ...(size === undefined ? {} : { size: normalizeUserPageSize(size) }),
        },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }
}
