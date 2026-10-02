import { TitleCasePipe } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEllipsis, lucideTrash2, lucideUserCog } from '@ng-icons/lucide';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import {
  projectRoleNames,
  type ProjectRole,
} from '@senv/api/shared/project-permissions';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmTableImports } from '@spartan-ng/helm/table';
import {
  FlexRender,
  injectTable,
  isFunction,
  type PaginationState,
  type SortingState,
  TanStackTable,
} from '@tanstack/angular-table';
import { TablePaginaton } from '../../../ui/table/pagination';
import { SearchInput } from '../../../ui/table/search-input';
import {
  memberColumns,
  memberActionsColumn,
  memberTableFeatures,
  type ProjectMember,
} from './member-columns';

@Component({
  selector: 'app-project-members',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TitleCasePipe,
    NgIcon,
    FlexRender,
    TanStackTable,
    TablePaginaton,
    SearchInput,
    HlmBadgeImports,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmDropdownMenuImports,
    HlmEmptyImports,
    HlmTableImports,
  ],
  providers: [provideIcons({ lucideEllipsis, lucideTrash2, lucideUserCog })],
  host: { class: 'grid gap-4 min-w-0' },
  template: `
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 id="members-heading" class="text-lg font-semibold">
        Members
        <span class="text-muted-foreground">{{ members().length }}</span>
      </h2>
      <app-search-input
        [query]="search()"
        (queryChange)="search.set($event)"
        (resetQuery)="search.set('')"
      />
    </header>
    <div class="overflow-hidden rounded-md border">
      <div hlmTableContainer>
        <table hlmTable aria-labelledby="members-heading">
          <thead hlmTHead>
            @for (group of table.getHeaderGroups(); track group.id) {
              <tr hlmTr>
                @for (header of group.headers; track header.id) {
                  <th
                    hlmTh
                    scope="col"
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
                    <ng-container
                      *flexRender="
                        header.column.columnDef.header;
                        props: header.getContext();
                        let content
                      "
                      >{{ content }}</ng-container
                    >
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
                      <button
                        hlmBtn
                        variant="ghost"
                        size="icon-xs"
                        align="end"
                        [disabled]="busy()"
                        [hlmDropdownMenuTrigger]="memberMenu"
                        [attr.aria-label]="
                          'Member actions for ' + row.original.user.name
                        "
                      >
                        <ng-icon name="lucideEllipsis" />
                      </button>
                      <ng-template #memberMenu>
                        <hlm-dropdown-menu>
                          <button
                            hlmDropdownMenuItem
                            [hlmDropdownMenuSubTrigger]="rolesMenu"
                            [disabled]="busy()"
                            [attr.aria-label]="
                              'Change role for ' + row.original.user.name
                            "
                          >
                            <ng-icon name="lucideUserCog" />
                            Role: {{ row.original.role | titlecase }}
                            <hlm-dropdown-menu-item-sub-indicator />
                          </button>
                          <hlm-dropdown-menu-separator />
                          <button
                            hlmDropdownMenuItem
                            variant="destructive"
                            [disabled]="busy()"
                            [hlmAlertDialogTriggerFor]="removeDialog"
                          >
                            <ng-icon name="lucideTrash2" />Remove member
                          </button>
                        </hlm-dropdown-menu>
                      </ng-template>
                      <ng-template #rolesMenu>
                        <hlm-dropdown-menu-sub>
                          @for (role of roles; track role) {
                            <button
                              hlmDropdownMenuRadio
                              [checked]="row.original.role === role"
                              [disabled]="busy() || row.original.role === role"
                              [keepOpen]="false"
                              (triggered)="
                                roleChanged.emit({
                                  memberId: row.original.id,
                                  role,
                                })
                              "
                            >
                              {{ role | titlecase }}
                              <hlm-dropdown-menu-radio-indicator />
                            </button>
                          }
                        </hlm-dropdown-menu-sub>
                      </ng-template>
                      <hlm-alert-dialog #removeDialog="hlmAlertDialog">
                        <hlm-alert-dialog-content
                          *hlmAlertDialogPortal="let ctx"
                        >
                          <hlm-alert-dialog-header>
                            <h3 hlmAlertDialogTitle>
                              Remove {{ row.original.user.name }}?
                            </h3>
                            <p hlmAlertDialogDescription>
                              They will lose access to this project. An admin
                              can invite them again later.
                            </p>
                          </hlm-alert-dialog-header>
                          <hlm-alert-dialog-footer>
                            <button hlmAlertDialogCancel>Cancel</button>
                            <button
                              hlmAlertDialogAction
                              variant="destructive"
                              [disabled]="busy()"
                              (click)="
                                removed.emit(row.original.id); ctx.close()
                              "
                            >
                              Remove member
                            </button>
                          </hlm-alert-dialog-footer>
                        </hlm-alert-dialog-content>
                      </hlm-alert-dialog>
                    } @else if (cell.column.id === 'role') {
                      <span hlmBadge variant="outline">{{
                        row.original.role | titlecase
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
                      @if (
                        cell.column.id === 'name' &&
                        row.original.userId === currentUserId()
                      ) {
                        <span class="text-muted-foreground text-sm">
                          (you)</span
                        >
                      }
                    }
                  </td>
                }
              </tr>
            } @empty {
              <tr hlmTr>
                <td hlmTd [attr.colspan]="columns().length">
                  <div hlmEmpty>
                    <div hlmEmptyHeader>
                      <h3 hlmEmptyTitle>
                        {{
                          members().length
                            ? 'No members found'
                            : 'No project members'
                        }}
                      </h3>
                      <p hlmEmptyDescription>
                        {{
                          members().length
                            ? 'Try a different email address.'
                            : 'Invite someone to join this project.'
                        }}
                      </p>
                    </div>
                  </div>
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
export class ProjectMembers {
  readonly projectId = input<string>();
  readonly members = input.required<ProjectMember[]>();
  readonly currentUserId = input<string>();
  readonly canManage = input(false);
  readonly busy = input(false);
  readonly roleChanged = output<{ memberId: string; role: ProjectRole }>();
  readonly roles = projectRoleNames;
  readonly removed = output<string>();
  readonly columns = computed(() =>
    this.canManage() ? [...memberColumns, memberActionsColumn] : memberColumns,
  );
  readonly search = linkedSignal(() => {
    this.projectId();
    return '';
  });
  readonly sorting = linkedSignal<SortingState>(() => {
    this.projectId();
    return [{ id: 'name', desc: false }];
  });
  private readonly filteredMembers = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.members().filter((member) =>
      member.user.email.toLowerCase().includes(search),
    );
  });
  readonly pagination = linkedSignal({
    source: () => [this.filteredMembers(), this.sorting()],
    computation: (_, previous): PaginationState => ({
      pageIndex: 0,
      pageSize: previous?.value.pageSize ?? 20,
    }),
  });
  readonly table = injectTable(() => ({
    key: 'project-members',
    features: memberTableFeatures,
    columns: this.columns(),
    data: this.filteredMembers(),
    getRowId: (member) => member.id,
    enableMultiSort: false,
    state: { pagination: this.pagination(), sorting: this.sorting() },
    onPaginationChange: (updater) =>
      this.pagination.set(
        isFunction(updater) ? updater(this.pagination()) : updater,
      ),
    onSortingChange: (updater) =>
      this.sorting.set(isFunction(updater) ? updater(this.sorting()) : updater),
  }));
}
