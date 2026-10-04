import { UsersData } from '../../../queries/users';
import {
  Component,
  computed,
  debounced,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSearch, lucideUsers, lucideX } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { injectQuery } from '@tanstack/angular-query';
import {
  FlexRender,
  injectTable,
  isFunction,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  TanStackTable,
} from '@tanstack/angular-table';
import { injectTanStackTableDevtools } from '@tanstack/angular-table-devtools';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { parseSort } from '../../../tools/table/sort';
import { TablePaginaton } from '../../../ui/table/pagination';
import { SearchInput } from '../../../ui/table/search-input';
import { TableSelectionActions } from '../../../ui/table/selection-actions';
import { userColumns } from './columns';
import { userTableFeatures } from './user-table-features';
import {
  navigateToUserPage,
  navigateToUserSort,
  synchronizeUserTableRoute,
} from './user-table-route-effects';
import { deleteSelectedUsers } from './delete-selected-users';
import { normalizeUserPage, normalizeUserPageSize } from './user-pagination';

@Component({
  selector: 'app-user-table',
  imports: [
    HlmButtonImports,
    HlmInputGroupImports,
    HlmTableImports,
    FlexRender,
    HlmEmptyImports,
    TanStackTable,
    NgIcon,
    TableSelectionActions,
    TablePaginaton,
    SearchInput,
  ],
  providers: [
    provideIcons({
      lucideSearch,
      lucideX,
      lucideUsers,
    }),
  ],
  host: { class: 'flex flex-col gap-3' },
  templateUrl: './user-table.html',
})
export class UserTable {
  private readonly router = inject(Router);
  private readonly sessionId = injectAuthSessionId();
  private readonly users = inject(UsersData);
  protected readonly deletingSelected = signal(false);

  readonly _columns = userColumns;

  protected readonly _availablePageSizes = [10, 20, 50, 100];

  readonly page = input<number, string>(1, { transform: normalizeUserPage });
  readonly size = input<number, string>(20, {
    transform: normalizeUserPageSize,
  });

  private readonly pagination = computed<PaginationState>(() => {
    const page = this.page();
    return {
      pageIndex: page - 1,
      pageSize: this.size(),
    };
  });

  readonly sort = input<SortingState, string>([], { transform: parseSort });
  readonly q = input<string | undefined>(undefined);

  protected readonly query = linkedSignal(this.q);
  private readonly debouncedQuery = debounced(this.query, 300);

  protected readonly inputValue = computed(() => this.query() ?? '');

  private readonly rowSelection = linkedSignal<RowSelectionState>(() => {
    this.pagination();
    this.sort();
    this.q();
    this.sessionId();
    return {};
  });

  protected readonly usersQuery = injectQuery(() => {
    const [sort] = this.sort();
    const q = this.q()?.trim();
    return this.users.list(this.sessionId(), {
      offset: this.pagination().pageIndex * this.pagination().pageSize,
      limit: this.pagination().pageSize,
      ...(sort
        ? {
            sortBy: sort.id,
            sortDirection: sort.desc ? ('desc' as const) : ('asc' as const),
          }
        : {}),
      ...(q
        ? {
            searchValue: q,
            searchField: 'email' as const,
            searchOperator: 'contains' as const,
          }
        : {}),
    });
  });

  protected readonly _table = injectTable(() => ({
    key: 'users-table',
    features: userTableFeatures,
    columns: userColumns,
    data: this.usersQuery.isError()
      ? []
      : (this.usersQuery.data()?.users ?? []),
    rowCount: this.usersQuery.data()?.total,
    getRowId: (row) => row.id,
    enableRowSelection: (row) =>
      !this.deletingSelected() && row.original.role !== 'admin',
    state: {
      sorting: this.sort(),
      pagination: this.pagination(),
      rowSelection: this.rowSelection(),
    },
    onSortingChange: (updater) =>
      navigateToUserSort(this.router, updater, this.sort()),
    onRowSelectionChange: (updater) => {
      if (isFunction(updater)) {
        this.rowSelection.update(updater);
      } else {
        this.rowSelection.set(updater);
      }
    },
    onPaginationChange: (updater) =>
      navigateToUserPage(this.router, updater, this.pagination()),
    manualPagination: true,
  }));

  constructor() {
    synchronizeUserTableRoute(
      this.usersQuery,
      this.pagination,
      this.router,
      this.debouncedQuery,
      this.q,
    );

    injectTanStackTableDevtools(() => ({
      table: this._table,
    }));
  }

  protected onSearchInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected onResetSearch(): void {
    this.query.set('');
  }

  protected async deleteSelected(closeDialog: () => void): Promise<void> {
    return deleteSelectedUsers({
      busy: this.deletingSelected,
      rows: this._table.getSelectedRowModel().rows,
      remove: (id) => this.users.remove(id),
      clearRow: (id) =>
        this.rowSelection.update((selection) => {
          const remaining = { ...selection };
          delete remaining[id];
          return remaining;
        }),
      invalidate: () => this.users.invalidate(),
      closeDialog,
    });
  }
}
