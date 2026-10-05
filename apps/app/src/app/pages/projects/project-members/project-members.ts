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
  templateUrl: './project-members.html',
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
