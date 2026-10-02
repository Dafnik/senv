import { UsersData } from '../../../queries/users';
import { lastPageIndex } from '../../../tools/table/pagination';
import { NumberInput } from '@angular/cdk/coercion';
import {
  Component,
  computed,
  debounced,
  effect,
  inject,
  input,
  linkedSignal,
  numberAttribute,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSearch, lucideUsers, lucideX } from '@ng-icons/lucide';
import { toast } from '@spartan-ng/brain/sonner';
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
import { parseSort, serializeSort } from '../../../tools/table/sort';
import { TablePaginaton } from '../../../ui/table/pagination';
import { SearchInput } from '../../../ui/table/search-input';
import { TableSelectionActions } from '../../../ui/table/selection-actions';
import { userColumns } from './columns';
import { userTableFeatures } from './user-table-features';

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
  template: `
    <div
      class="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"
    >
      <app-search-input
        [query]="inputValue()"
        (queryChange)="query.set($event)"
        (resetQuery)="query.set('')"
      />

      @if (_table.getSelectedRowModel().rows.length; as rowLength) {
        <app-table-selection-actions
          [count]="rowLength"
          [pending]="deletingSelected()"
          (confirmed)="deleteSelected($event)"
        />
      }
    </div>

    <div class="overflow-hidden rounded-md border">
      <div hlmTableContainer>
        <table hlmTable>
          <thead hlmTHead>
            @for (
              headerGroup of _table.getHeaderGroups();
              track headerGroup.id
            ) {
              <tr hlmTr>
                @for (header of headerGroup.headers; track header.id) {
                  <th
                    hlmTh
                    [attr.colSpan]="header.colSpan"
                    [attr.aria-sort]="
                      header.column.getCanSort()
                        ? header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : 'none'
                        : null
                    "
                  >
                    @if (!header.isPlaceholder) {
                      <ng-container
                        *flexRender="
                          header.column.columnDef.header;
                          props: header.getContext();
                          let headerText
                        "
                      >
                        <div [innerHTML]="headerText"></div>
                      </ng-container>
                    }
                  </th>
                }
              </tr>
            }
          </thead>
          <tbody hlmTBody>
            @for (row of _table.getRowModel().rows; track row.id) {
              <tr hlmTr [attr.key]="row.id">
                @for (cell of row.getAllCells(); track cell.id) {
                  <td hlmTd>
                    <ng-container
                      *flexRender="
                        cell.column.columnDef.cell;
                        props: cell.getContext();
                        let cell
                      "
                    >
                      <div [innerHTML]="cell"></div>
                    </ng-container>
                  </td>
                }
              </tr>
            } @empty {
              <tr hlmTr>
                <td
                  hlmTd
                  class="h-24 text-center"
                  [attr.colspan]="_columns.length"
                >
                  <hlm-empty class="border-0 py-10">
                    <hlm-empty-header>
                      <hlm-empty-media variant="icon">
                        <ng-icon name="lucideUsers" />
                      </hlm-empty-media>
                      @if (usersQuery.isError()) {
                        <div hlmEmptyTitle>Could not load users</div>
                        <p hlmEmptyDescription role="alert">
                          {{ usersQuery.error().message }}
                        </p>
                      } @else if (usersQuery.isPending()) {
                        <div hlmEmptyTitle>Loading users</div>
                      } @else {
                        <div hlmEmptyTitle>No users found</div>
                        <p hlmEmptyDescription>Try adjusting your search.</p>
                      }
                    </hlm-empty-header>
                    @if (usersQuery.isError()) {
                      <hlm-empty-content>
                        <button
                          hlmBtn
                          variant="outline"
                          size="sm"
                          type="button"
                          [disabled]="usersQuery.isFetching()"
                          (click)="usersQuery.refetch()"
                        >
                          Try again
                        </button>
                      </hlm-empty-content>
                    } @else if (q() && !usersQuery.isPending()) {
                      <hlm-empty-content>
                        <button
                          hlmBtn
                          variant="outline"
                          size="sm"
                          type="button"
                          (click)="onResetSearch()"
                        >
                          Clear search
                        </button>
                      </hlm-empty-content>
                    }
                  </hlm-empty>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
    <div [tanStackTable]="_table">
      <app-table-pagination [pageSizes]="_availablePageSizes" />
    </div>
  `,
})
export class UserTable {
  private readonly router = inject(Router);
  private readonly sessionId = injectAuthSessionId();
  private readonly users = inject(UsersData);
  protected readonly deletingSelected = signal(false);

  readonly _columns = userColumns;

  protected readonly _availablePageSizes = [10, 20, 50, 100];

  readonly page = input<number, NumberInput>(1, {
    transform: (value) => numberAttribute(value, 1),
  });
  readonly size = input<number, NumberInput>(20, {
    transform: (value) => numberAttribute(value, 20),
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
    onSortingChange: (updater) => {
      this.router.navigate([], {
        queryParams: {
          sort: serializeSort(
            isFunction(updater) ? updater(this.sort()) : updater,
          ),
        },
        queryParamsHandling: 'merge',
      });
    },
    onRowSelectionChange: (updater) => {
      if (isFunction(updater)) {
        this.rowSelection.update(updater);
      } else {
        this.rowSelection.set(updater);
      }
    },
    onPaginationChange: (updater) => {
      const pagination = isFunction(updater)
        ? updater(this.pagination())
        : updater;
      this.router.navigate([], {
        queryParams: {
          page: pagination.pageIndex + 1,
          size: pagination.pageSize,
        },
        queryParamsHandling: 'merge',
      });
    },
    manualPagination: true,
  }));

  constructor() {
    effect(() => {
      if (!this.usersQuery.isSuccess() || this.usersQuery.isFetching()) return;
      const lastPage = lastPageIndex(
        this.usersQuery.data().total,
        this.pagination().pageSize,
      );
      if (this.pagination().pageIndex > lastPage)
        void this.router.navigate([], {
          queryParams: { page: lastPage + 1 },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
    });
    effect(() => {
      const value = this.debouncedQuery.value() ?? '';
      const q = value.trim();

      if (q === (this.q() ?? '').trim()) {
        return;
      }

      this.router.navigate([], {
        queryParams: { q: q || undefined, page: 1 },
        queryParamsHandling: 'merge',
      });
    });

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
    if (this.deletingSelected()) return;
    const selectedRows = this._table.getSelectedRowModel().rows;
    this.deletingSelected.set(true);
    const failures: string[] = [];
    try {
      for (const row of selectedRows) {
        try {
          await this.users.remove(row.original.id);
          this.rowSelection.update((selection) => {
            const remaining = { ...selection };
            delete remaining[row.id];
            return remaining;
          });
        } catch (error) {
          failures.push(
            error instanceof Error ? error.message : 'The request failed.',
          );
        }
      }
      if (failures.length) {
        toast.error(
          `Could not delete ${failures.length} ${failures.length === 1 ? 'user' : 'users'}. ${failures[0]}`,
        );
      } else {
        closeDialog();
      }
      await this.users.invalidate();
    } finally {
      this.deletingSelected.set(false);
    }
  }
}
