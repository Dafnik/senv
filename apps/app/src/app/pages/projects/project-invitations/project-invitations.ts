import { TitleCasePipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import {
  ChangeDetectionStrategy,
  Component,
  debounced,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { isInvitationSortField } from '@senv/api/shared/project-invitations';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { injectQuery } from '@tanstack/angular-query';
import {
  FlexRender,
  injectTable,
  isFunction,
  type PaginationState,
  type SortingState,
  TanStackTable,
} from '@tanstack/angular-table';
import { injectAuthSessionId } from '../../../auth/auth-client';
import { ProjectsData } from '../../../queries/projects';
import { lastPageIndex } from '../../../tools/table/pagination';
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
    TitleCasePipe,
    NgIcon,
    FlexRender,
    TanStackTable,
    TablePaginaton,
    SearchInput,
    InviteForm,
    HlmTableImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmSpinnerImports,
  ],
  providers: [provideIcons({ lucideX })],
  host: { class: 'grid gap-4' },
  template: `
    <header class="grid gap-1">
      <h2 id="invitations-heading" class="text-lg font-semibold">
        Open invitations
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
                          <ng-icon name="lucideX" />Cancel
                        </button>
                      }
                    } @else if (cell.column.id === 'role') {
                      {{ row.original.role | titlecase }}
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
                        <div hlmEmptyTitle>No open invitations found</div>
                        <p hlmEmptyDescription>
                          Send an invitation or try a different email address.
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
  private readonly projects = inject(ProjectsData);
  private readonly sessionId = injectAuthSessionId();
  readonly columns = invitationColumns;
  readonly search = linkedSignal(() => {
    this.projectId();
    return '';
  });
  private readonly debouncedSearch = debounced(this.search, 300);
  readonly sorting = linkedSignal<SortingState>(() => {
    this.projectId();
    return [{ id: 'createdAt', desc: true }];
  });
  readonly busy = signal(false);
  readonly pagination = linkedSignal({
    source: () => [
      this.projectId(),
      this.sessionId(),
      this.debouncedSearch.value(),
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
    const input = {
      projectId: this.projectId(),
      offset: pageIndex * pageSize,
      limit: pageSize,
      search: this.debouncedSearch.value() ?? '',
      sortBy:
        sort && isInvitationSortField(sort.id)
          ? sort.id
          : ('createdAt' as const),
      sortDirection: sort?.desc ? ('desc' as const) : ('asc' as const),
    };
    return this.projects.invitations(this.sessionId(), input);
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

  async refresh(sessionId = this.sessionId(), projectId = this.projectId()) {
    await this.projects.invalidateInvitations(sessionId, projectId);
    if (this.sessionId() !== sessionId || this.projectId() !== projectId)
      return;
    const lastPage = lastPageIndex(
      this.invitations.data()?.total ?? 0,
      this.pagination().pageSize,
    );
    if (this.pagination().pageIndex > lastPage)
      this.pagination.update((page) => ({ ...page, pageIndex: lastPage }));
  }

  async cancel(invitationId: string) {
    if (this.busy()) return;
    this.busy.set(true);
    const projectId = this.projectId();
    const sessionId = this.sessionId();
    try {
      await this.projects.cancelInvitation(projectId, invitationId);
      await this.refresh(sessionId, projectId);
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
