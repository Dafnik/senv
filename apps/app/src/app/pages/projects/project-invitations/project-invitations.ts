import {
  ChangeDetectionStrategy,
  Component,
  debounced,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import {
  invitationStatuses,
  isInvitationSortField,
  type InvitationStatus,
} from '@senv/api/shared/project-invitations';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { injectQuery, QueryClient } from '@tanstack/angular-query';
import {
  FlexRender,
  injectTable,
  isFunction,
  type PaginationState,
  type SortingState,
  TanStackTable,
} from '@tanstack/angular-table';
import {
  injectAuthClient,
  injectAuthSessionId,
} from '../../../auth/auth-client';
import { unwrapAuthResult } from '../../../auth/auth-result';
import { injectTrpc } from '../../../trpc/trpc.service';
import { TablePaginaton } from '../../../ui/table/pagination';
import { SearchInput } from '../../../ui/table/search-input';
import { InviteForm } from '../invite-form/invite-form';
import {
  invitationColumns,
  invitationTableFeatures,
} from './invitation-columns';

@Component({
  selector: 'app-project-invitations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FlexRender,
    TanStackTable,
    TablePaginaton,
    SearchInput,
    InviteForm,
    HlmTableImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmSelectImports,
    HlmSpinnerImports,
  ],
  host: { class: 'grid gap-4' },
  template: `
    <header class="grid gap-1">
      <h2 id="invitations-heading" class="text-lg font-semibold">
        Invitations
      </h2>
      <p class="text-muted-foreground text-sm">
        Invite teammates with a link that expires in seven days. Only admins can
        manage members and project settings.
      </p>
    </header>
    <app-invite-form [projectId]="projectId()" (sent)="refresh()" />
    <div class="flex flex-wrap items-center justify-between gap-3">
      <app-search-input
        [query]="search()"
        (queryChange)="search.set($event)"
        (resetQuery)="search.set('')"
      />
      <div hlmField orientation="horizontal">
        <label hlmFieldLabel for="invitation-status">Status</label>
        <hlm-select
          [value]="status()"
          [itemToString]="statusLabel"
          (valueChange)="selectStatus($event)"
        >
          <hlm-select-trigger buttonId="invitation-status" class="capitalize"
            ><hlm-select-value
          /></hlm-select-trigger>
          <hlm-select-content *hlmSelectPortal>
            <hlm-select-group>
              <hlm-select-item value="all">All statuses</hlm-select-item>
              @for (status of statuses; track status) {
                <hlm-select-item [value]="status" class="capitalize">{{
                  status
                }}</hlm-select-item>
              }
            </hlm-select-group>
          </hlm-select-content>
        </hlm-select>
      </div>
    </div>
    <div class="overflow-hidden rounded-md border">
      <div hlmTableContainer>
        <table
          hlmTable
          aria-labelledby="invitations-heading"
          [attr.aria-busy]="invitations.isFetching()"
        >
          <thead hlmTHead>
            @for (group of table.getHeaderGroups(); track group.id) {
              <tr hlmTr>
                @for (header of group.headers; track header.id) {
                  <th hlmTh [attr.colSpan]="header.colSpan">
                    @if (!header.isPlaceholder) {
                      <ng-container
                        *flexRender="
                          header.column.columnDef.header;
                          props: header.getContext();
                          let content
                        "
                        >{{ content }}</ng-container
                      >
                    }
                  </th>
                }
              </tr>
            }
          </thead>
          <tbody hlmTBody>
            @for (row of table.getRowModel().rows; track row.id) {
              <tr hlmTr>
                @for (cell of row.getAllCells(); track cell.id) {
                  <td hlmTd>
                    @if (cell.column.id === 'actions') {
                      @if (row.original.status === 'pending') {
                        <button
                          hlmBtn
                          variant="ghost"
                          size="sm"
                          [disabled]="busy()"
                          [attr.aria-label]="
                            'Cancel invitation for ' + row.original.email
                          "
                          (click)="cancel(row.original.id)"
                        >
                          Cancel
                        </button>
                      }
                    } @else if (cell.column.id === 'status') {
                      <span hlmBadge variant="secondary">{{
                        row.original.status
                      }}</span>
                    } @else {
                      <ng-container
                        *flexRender="
                          cell.column.columnDef.cell;
                          props: cell.getContext();
                          let content
                        "
                        >{{ content }}</ng-container
                      >
                    }
                  </td>
                }
              </tr>
            } @empty {
              <tr hlmTr>
                <td hlmTd [attr.colspan]="columns.length">
                  <hlm-empty>
                    <hlm-empty-header>
                      @if (invitations.isError()) {
                        <div hlmEmptyTitle>Could not load invitations</div>
                        <p hlmEmptyDescription role="alert">
                          {{ invitations.error().message }}
                        </p>
                      } @else if (invitations.isPending()) {
                        <hlm-spinner aria-label="Loading invitations" />
                      } @else {
                        <div hlmEmptyTitle>No invitations found</div>
                        <p hlmEmptyDescription>
                          Send an invitation or adjust your filters.
                        </p>
                      }
                    </hlm-empty-header>
                    @if (invitations.isError()) {
                      <hlm-empty-content
                        ><button
                          hlmBtn
                          variant="outline"
                          (click)="invitations.refetch()"
                        >
                          Try again
                        </button></hlm-empty-content
                      >
                    }
                  </hlm-empty>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>
    <div [tanStackTable]="table"><app-table-pagination /></div>
  `,
})
export class ProjectInvitations {
  readonly projectId = input.required<string>();
  private readonly auth = injectAuthClient();
  private readonly sessionId = injectAuthSessionId();
  private readonly trpc = injectTrpc();
  private readonly queryClient = inject(QueryClient);
  readonly columns = invitationColumns;
  readonly statuses = invitationStatuses;
  readonly statusLabel = (value: unknown) =>
    value === 'all' ? 'All statuses' : String(value);
  readonly search = signal('');
  private readonly debouncedSearch = debounced(this.search, 300);
  readonly status = signal<InvitationStatus | 'all'>('all');
  readonly sorting = signal<SortingState>([{ id: 'createdAt', desc: true }]);
  readonly busy = signal(false);
  readonly pagination = linkedSignal({
    source: () => [
      this.projectId(),
      this.sessionId(),
      this.debouncedSearch.value(),
      this.status(),
      this.sorting(),
    ],
    computation: (_, previous): PaginationState => ({
      pageIndex: 0,
      pageSize: previous?.value.pageSize ?? 20,
    }),
  });
  readonly invitations = injectQuery(() => {
    const { pageIndex, pageSize } = this.pagination();
    const sort = this.sorting()[0];
    const status = this.status();
    const input = {
      projectId: this.projectId(),
      offset: pageIndex * pageSize,
      limit: pageSize,
      search: this.debouncedSearch.value() ?? '',
      status: status === 'all' ? undefined : status,
      sortBy:
        sort && isInvitationSortField(sort.id)
          ? sort.id
          : ('createdAt' as const),
      sortDirection: sort?.desc ? ('desc' as const) : ('asc' as const),
    };
    return {
      queryKey: [
        'project-invitations',
        this.sessionId(),
        this.projectId(),
        input,
      ],
      enabled: !!this.sessionId(),
      queryFn: ({ signal }) =>
        this.trpc.client.projects.invitations.query(input, { signal }),
    };
  });
  readonly table = injectTable(() => ({
    key: 'project-invitations',
    features: invitationTableFeatures,
    columns: invitationColumns,
    data: this.invitations.isError()
      ? []
      : (this.invitations.data()?.invitations ?? []),
    rowCount: this.invitations.data()?.total ?? 0,
    getRowId: (row) => row.id,
    manualPagination: true,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    state: { pagination: this.pagination(), sorting: this.sorting() },
    onPaginationChange: (updater) =>
      this.pagination.set(
        isFunction(updater) ? updater(this.pagination()) : updater,
      ),
    onSortingChange: (updater) =>
      this.sorting.set(isFunction(updater) ? updater(this.sorting()) : updater),
  }));

  selectStatus(value: unknown) {
    if (
      value === 'all' ||
      invitationStatuses.some((status) => status === value)
    )
      this.status.set(value as InvitationStatus | 'all');
  }

  async refresh() {
    await this.queryClient.invalidateQueries({
      queryKey: ['project-invitations', this.sessionId(), this.projectId()],
    });
    const lastPage = Math.max(
      0,
      Math.ceil(
        (this.invitations.data()?.total ?? 0) / this.pagination().pageSize,
      ) - 1,
    );
    if (this.pagination().pageIndex > lastPage)
      this.pagination.update((page) => ({ ...page, pageIndex: lastPage }));
  }

  async cancel(invitationId: string) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      unwrapAuthResult(
        await this.auth.organization.cancelInvitation({ invitationId }),
      );
      await this.refresh();
      toast.success('Invitation cancelled.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not cancel the invitation.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
